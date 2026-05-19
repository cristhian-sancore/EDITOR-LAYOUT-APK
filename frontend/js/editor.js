// editor.js – funcionalidade do editor CPCL via engenharia reversa de Smali
// ---------------------------------------------------------------
// Configurações da etiqueta (ZQ520 – 104mm / ZQ521)
const DOTS_W = 200;               // resolução DPI
const DOTS_H = 1200;              // altura em dots no cabeçalho
const SCALE_X = 8;                // 1 mm = 8px no canvas
const SCALE_Y = 8;                // 1 mm = 8px no canvas

const canvas = new fabric.Canvas('cvs', {
  backgroundColor: '#fff',
  selection: true,
  preserveObjectStacking: true,
});

// Custom properties
const CUSTOM_PROPS = ['cpclFont', 'selectable', 'evented', 'id', 'originalSmali', 'fullString'];

const $ = selector => document.querySelector(selector);
function showToast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),1800);
}

let currentTool = null;
function setTool(tool){
  currentTool = tool;
  canvas.isDrawingMode = false;
}

// Botões de ferramenta (desativados nesta versão, pois a adição quebra o smali se não houver um originalSmali)
// Como o layout smali exige modificar elementos que JÁ EXISTEM no código Java, não podemos "Adicionar Novo Texto" livremente 
// a menos que soubéssemos onde injetar o código Java inteiro (o que é arriscado).
// Vamos focar na movimentação e formatação dos itens existentes.
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',()=> {
    showToast('Adição de novos elementos desativada para manter a integridade do código Java. Edite os existentes.');
  });
});

/*** PROPRIEDADES – aplica a objetos selecionados ***/
function loadProperties(obj){
  if(!obj) { $('#propPanel').classList.add('hidden'); return; }
  $('#propPanel').classList.remove('hidden');
  
  if(obj.type==='i-text'){
    $('#fontFamily').value = obj.cpclFont || '7';
    $('#fontSize').value   = Math.round(obj.fontSize);
    $('#fontColor').value  = obj.fill;
    $('#textContent').value = obj.text;
    $('#textContent').parentElement.style.display = 'block';
  }else{
    $('#fontFamily').value = '5';
    $('#fontSize').value   = 12;
    $('#fontColor').value  = obj.stroke || '#000';
    $('#textContent').value = '';
    $('#textContent').parentElement.style.display = 'none';
  }
}
canvas.on('selection:created', () => loadProperties(canvas.getActiveObject()));
canvas.on('selection:updated', () => loadProperties(canvas.getActiveObject()));
canvas.on('selection:cleared', () => loadProperties(null));

canvas.on('object:scaling', (e) => {
  const obj = e.target;
  if (obj && obj.type === 'i-text') {
    obj.fontSize = Math.round(obj.fontSize * obj.scaleY);
    obj.scaleX = 1;
    obj.scaleY = 1;
    obj.cpclFont = obj.fontSize > 16 ? '7' : '5';
    loadProperties(obj);
  }
});

$('#applyProps').addEventListener('click',()=>{
  const obj = canvas.getActiveObject();
  if(!obj) return;
  const font = $('#fontFamily').value;
  const size = parseInt($('#fontSize').value,10);
  const color = $('#fontColor').value;
  
  if(obj.type==='i-text'){
    obj.set({
      fontFamily:'Inter', 
      fontSize:size, 
      fill:color, 
      cpclFont:font,
      text: $('#textContent').value
    });
    // If the user manually edits the text, it's no longer considered a dynamic variable wrapper
    if (!obj.text.startsWith('[') || !obj.text.endsWith(']')) {
       obj.isDynamic = false;
    }
  }else if(obj.type==='rect' || obj.type==='line'){
    obj.set({stroke:color});
  }
  canvas.renderAll();
});

// Ações rápidas: Deletar e Duplicar desativadas pelo mesmo motivo de integridade do Java
$('#deleteObj').addEventListener('click', () => {
  showToast('Para remover um elemento de código, arraste-o para fora da página ou deixe vazio.');
});
$('#duplicateObj').addEventListener('click', () => {
  showToast('Duplicação desativada. O Smali exige chaves de código únicas.');
});

canvas.includeDefaultValues = false;

$('#applyPaperSize').addEventListener('click', () => {
  const w = parseFloat($('#paperWidth').value) || 105;
  const h = parseFloat($('#paperHeight').value) || 250;
  
  canvas.setWidth(w * SCALE_X);
  canvas.setHeight(h * SCALE_Y);
  
  const objs = canvas.getObjects();
  objs.filter(o => o.stroke === '#e5e7eb').forEach(o => canvas.remove(o));
  drawGrid();
  
  showToast(`Bobina ajustada para ${w}x${h} mm`);
});

// Lógica para Molde (Imagem de Fundo)
$('#bgUploadBtn')?.addEventListener('click', () => {
  $('#bgUploadInput').click();
});

$('#bgUploadInput')?.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(f) {
    const data = f.target.result;
    fabric.Image.fromURL(data, function(img) {
      // Ajusta a imagem para caber no tamanho do papel (canvas)
      const scaleX = canvas.width / img.width;
      // Para não distorcer, mantemos a proporção? O papel termico geralmente não é distorcido.
      // Vamos forçar o tamanho exato do canvas
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
        scaleX: canvas.width / img.width,
        scaleY: canvas.height / img.height,
        opacity: 0.5 // Deixa meio transparente para ver a grade
      });
      $('#bgRemoveBtn').style.display = 'block';
    });
  };
  reader.readAsDataURL(file);
});

$('#bgRemoveBtn')?.addEventListener('click', () => {
  canvas.setBackgroundImage(null, canvas.renderAll.bind(canvas));
  $('#bgRemoveBtn').style.display = 'none';
  $('#bgUploadInput').value = ''; // reseta
});

function drawGrid(){
  const step = 20; 
  for(let i=0;i<canvas.width;i+=step){
    canvas.add(new fabric.Line([i,0,i,canvas.height],{stroke:'#e5e7eb',strokeWidth:0.5, selectable:false, evented:false}));
  }
  for(let j=0;j<canvas.height;j+=step){
    canvas.add(new fabric.Line([0,j,canvas.width,j],{stroke:'#e5e7eb',strokeWidth:0.5, selectable:false, evented:false}));
  }
}
drawGrid();

function mapCanvasToDots(val){ return Math.round(val / SCALE_X); }

/*** RENDER SMALI TO CANVAS ***/
window.renderSmaliToCanvas = function(elements) {
  canvas.clear();
  canvas.backgroundColor = '#fff';
  drawGrid();

  if(!elements || elements.length === 0) return;

  elements.forEach(el => {
    if (el.type === 'T') {
      const x = el.x * SCALE_X;
      const y = el.y * SCALE_Y;
      const font = el.font.toString();
      const fontSize = font === '7' ? 18 : 14;
      
      const txtObj = new fabric.IText(el.text || '[Variável Dinâmica]', {
        left: x,
        top: y,
        fontFamily: 'Inter',
        fontSize: fontSize,
        fill: '#000',
        cpclFont: font,
        originalSmali: el.original_smali,
        fullString: el.full_string,
        isDynamic: el.text && el.text.startsWith('[') && el.text.endsWith(']')
      });
      canvas.add(txtObj);
    } 
    else if (el.type === 'LINE') {
      const x0 = el.x0 * SCALE_X;
      const y0 = el.y0 * SCALE_Y;
      const x1 = el.x1 * SCALE_X;
      const y1 = el.y1 * SCALE_Y;
      
      const lineObj = new fabric.Line([x0, y0, x1, y1], {
        stroke: '#333',
        strokeWidth: 2,
        originalSmali: el.original_smali,
        fullString: el.full_string
      });
      canvas.add(lineObj);
    }
  });
  
  canvas.renderAll();
}

/*** GENERATE SMALI REPLACEMENTS ***/
window.generateSmaliReplacements = function() {
  const replacements = [];
  
  canvas.getObjects().forEach(obj => {
    if (!obj.originalSmali) return;
    
    if (obj.type === 'i-text') {
      const x = mapCanvasToDots(obj.left);
      const y = mapCanvasToDots(obj.top);
      const font = obj.cpclFont || '7';
      const size = '0'; // Smali sizes are usually 0 by default
      const txt = obj.isDynamic ? '' : obj.text.replace(/\r?\n/g,' ');
      
      // We reconstruct the string: "T font size x y text"
      // But we must respect the original spacing/trailing characters.
      // Let's just create a new string based on the standard CPCL format.
      // The original full_string was captured from regex.
      // e.g. "T 7 0 5 116 CLORO \r\n"
      
      // Extract any trailing whitespace or \r\n from original fullString if txt is empty
      let tail = "";
      if(obj.fullString.endsWith("\\r\\n")) tail = "\\r\\n";
      else if(obj.fullString.endsWith(" ")) tail = " ";
      
      const newInnerString = `T ${font} ${size} ${x} ${y} ${txt}${tail}`;
      const newSmali = obj.originalSmali.replace(obj.fullString, newInnerString);
      
      if (newSmali !== obj.originalSmali) {
        replacements.push({
          original: obj.originalSmali,
          new: newSmali
        });
      }
    } 
    else if (obj.type === 'line') {
      if(obj.stroke === '#e5e7eb') return; // ignora o grid
      const x0 = mapCanvasToDots(obj.left);
      const y0 = mapCanvasToDots(obj.top);
      const x1 = mapCanvasToDots(obj.left + obj.width);
      const y1 = mapCanvasToDots(obj.top + obj.height);
      
      const newInnerString = `LINE ${x0} ${y0} ${x1} ${y1} 0.2`;
      const newSmali = obj.originalSmali.replace(obj.fullString, newInnerString);
      
      if (newSmali !== obj.originalSmali) {
        replacements.push({
          original: obj.originalSmali,
          new: newSmali
        });
      }
    }
  });
  
  return replacements;
}
