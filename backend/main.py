import os
import uuid
import subprocess
import shutil
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKSPACE_DIR = "/app/workspace"
KEYSTORE_PATH = "/app/debug.keystore"

os.makedirs(WORKSPACE_DIR, exist_ok=True)

class SaveLayoutRequest(BaseModel):
    cpcl: str

def find_cpcl_file(source_dir: str) -> str:
    """Procura por um arquivo contendo CPCL ou as variaveis de impressao"""
    search_dirs = [
        os.path.join(source_dir, "assets"),
        os.path.join(source_dir, "res", "raw")
    ]
    
    for s_dir in search_dirs:
        if not os.path.exists(s_dir):
            continue
        for root, _, files in os.walk(s_dir):
            for file in files:
                if file.endswith(('.txt', '.cpcl', '.prn')):
                    filepath = os.path.join(root, file)
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            # Verifica se parece ser o arquivo de layout
                            if "{NOME_COMPROMISSARIO}" in content or "! 0 200" in content or "LANCAMENTO_DESC_1" in content:
                                return filepath
                    except Exception:
                        pass
                        
    # Se nao achar nas pastas especificas, procura em toda a pasta
    for root, _, files in os.walk(source_dir):
        for file in files:
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    if "{NOME_COMPROMISSARIO}" in content or "LANCAMENTO_DESC_1" in content:
                        return filepath
            except Exception:
                pass

    return None

@app.post("/api/upload")
async def upload_apk(file: UploadFile = File(...)):
    session_id = str(uuid.uuid4())
    session_dir = os.path.join(WORKSPACE_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    apk_path = os.path.join(session_dir, "app.apk")
    with open(apk_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    source_dir = os.path.join(session_dir, "source")
    
    # Run apktool decode
    try:
        subprocess.run(["apktool", "d", "-f", apk_path, "-o", source_dir], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        return JSONResponse(status_code=500, content={"error": "Erro ao descompilar APK", "details": e.stderr})
        
    cpcl_file = find_cpcl_file(source_dir)
    if not cpcl_file:
        return JSONResponse(status_code=404, content={"error": "Arquivo de layout CPCL não encontrado dentro do APK."})
        
    # Save the relative path of the CPCL file for this session
    with open(os.path.join(session_dir, "layout_path.txt"), "w") as f:
        f.write(cpcl_file)
        
    with open(cpcl_file, "r", encoding="utf-8", errors="ignore") as f:
        cpcl_content = f.read()
        
    return {
        "session_id": session_id,
        "cpcl_content": cpcl_content,
        "file_name": os.path.basename(cpcl_file)
    }

@app.post("/api/build/{session_id}")
async def build_apk(session_id: str, data: SaveLayoutRequest):
    session_dir = os.path.join(WORKSPACE_DIR, session_id)
    if not os.path.exists(session_dir):
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
        
    layout_path_file = os.path.join(session_dir, "layout_path.txt")
    if not os.path.exists(layout_path_file):
        raise HTTPException(status_code=404, detail="Caminho do layout não encontrado")
        
    with open(layout_path_file, "r") as f:
        cpcl_file = f.read().strip()
        
    # Overwrite the CPCL file
    with open(cpcl_file, "w", encoding="utf-8") as f:
        f.write(data.cpcl)
        
    source_dir = os.path.join(session_dir, "source")
    dist_apk = os.path.join(source_dir, "dist", "app.apk")
    
    # 1. Build new APK
    try:
        subprocess.run(["apktool", "b", source_dir], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Erro ao compilar APK: {e.stderr}")
        
    # 2. Zipalign
    aligned_apk = os.path.join(session_dir, "app-aligned.apk")
    try:
        subprocess.run(["zipalign", "-f", "-v", "4", dist_apk, aligned_apk], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Erro no zipalign: {e.stderr}")
        
    # 3. Sign APK
    final_apk = os.path.join(session_dir, "app-modificado.apk")
    try:
        # We copy aligned to final and sign in place
        shutil.copy(aligned_apk, final_apk)
        subprocess.run([
            "apksigner", "sign", 
            "--ks", KEYSTORE_PATH, 
            "--ks-pass", "pass:android",
            final_apk
        ], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Erro ao assinar APK: {e.stderr}")
        
    return {"status": "ok", "download_url": f"/api/download/{session_id}"}

@app.get("/api/download/{session_id}")
async def download_apk(session_id: str):
    final_apk = os.path.join(WORKSPACE_DIR, session_id, "app-modificado.apk")
    if not os.path.exists(final_apk):
        raise HTTPException(status_code=404, detail="APK não encontrado")
    return FileResponse(final_apk, media_type="application/vnd.android.package-archive", filename="app-modificado.apk")
