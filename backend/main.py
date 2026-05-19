import os
import uuid
import subprocess
import shutil
import re
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict

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

class SaveSmaliRequest(BaseModel):
    replacements: List[Dict[str, str]]
    layout_file: str

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
        
    return {
        "session_id": session_id,
        "message": "APK extraído com sucesso"
    }

@app.get("/api/list_layouts/{session_id}")
async def list_layouts(session_id: str):
    source_dir = os.path.join(WORKSPACE_DIR, session_id, "source")
    if not os.path.exists(source_dir):
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
        
    layouts = []
    # Search for Cpcl*.smali files
    for root, _, files in os.walk(source_dir):
        if "smali" in root: # Optimization: only look inside smali folders
            for file in files:
                if file.startswith("Cpcl") and file.endswith(".smali"):
                    rel_path = os.path.relpath(os.path.join(root, file), source_dir)
                    # Convert backslash to forward slash for consistency in JSON
                    layouts.append(rel_path.replace("\\", "/"))
                    
    return {"layouts": sorted(layouts)}

@app.get("/api/get_layout_smali/{session_id}")
async def get_layout_smali(session_id: str, layout_file: str):
    filepath = os.path.join(WORKSPACE_DIR, session_id, "source", layout_file)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Arquivo de layout não encontrado")
        
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
        
    elements = []
    
    # Find all CPCL text strings
    # Pattern: const-string vX, "T font size x y text"
    t_pattern = re.compile(r'const-string [vp]\d+, "(T (\d+) (\d+) (\d+) (\d+)(.*?))"')
    for match in t_pattern.finditer(content):
        original_smali = match.group(0) # The full const-string line
        full_string = match.group(1) # The inner string "T 7 0 5 116 CLORO "
        font = int(match.group(2))
        size = int(match.group(3))
        x = int(match.group(4))
        y = int(match.group(5))
        text = match.group(6)
        
        elements.append({
            "original_smali": original_smali,
            "full_string": full_string,
            "type": "T",
            "x": x,
            "y": y,
            "font": font,
            "size": size,
            "text": text.strip()
        })
        
    # Find all LINE strings
    line_pattern = re.compile(r'const-string [vp]\d+, "(LINE (\d+) (\d+) (\d+) (\d+) (\d+(?:\.\d+)?))"')
    for match in line_pattern.finditer(content):
        original_smali = match.group(0)
        full_string = match.group(1)
        x0 = int(match.group(2))
        y0 = int(match.group(3))
        x1 = int(match.group(4))
        y1 = int(match.group(5))
        thickness = float(match.group(6))
        
        elements.append({
            "original_smali": original_smali,
            "full_string": full_string,
            "type": "LINE",
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
            "thickness": thickness
        })
        
    return {"elements": elements}

@app.post("/api/save_layout_smali/{session_id}")
async def save_layout_smali(session_id: str, data: SaveSmaliRequest):
    filepath = os.path.join(WORKSPACE_DIR, session_id, "source", data.layout_file)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Arquivo de layout não encontrado")
        
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Apply replacements
    for rep in data.replacements:
        orig = rep.get("original")
        new = rep.get("new")
        if orig and new:
            content = content.replace(orig, new)
            
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
        
    return {"status": "ok"}

@app.post("/api/build/{session_id}")
async def build_apk(session_id: str):
    session_dir = os.path.join(WORKSPACE_DIR, session_id)
    if not os.path.exists(session_dir):
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
        
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
