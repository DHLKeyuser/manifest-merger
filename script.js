// ─── constants & globals ───────────────────────────────────────────────────
const LEFT            = 30,
      PAGE_W          = 842,
      PAGE_H          = 595,
      ROW_H           = 12,
      HEADER_H        = ROW_H * 2.2,
      GAP_AFTER_TOTAL = 14;

const COL_HEADERS = [
  ["Load no.",""], ["Loadingplace",""], ["Order number","Reference no."],
  ["Delivery ID","HU-ID"], ["HU-Description",""], ["Delivery","HU Remark"],
  ["Gross","kg/volume"], ["Country / ZIP / City","Planned QTY"],
  ["Actual","QTY"], ["Service",""]
];

const COL_WIDTHS = [50, 60, 80, 70, 90, 130, 70, 110, 45, 75];
const TABLE_W    = COL_WIDTHS.reduce((a,b)=>a+b,0);
const VALID_CODES = [ /* … your codes here … */ ];

let pdfFiles         = [];
let qrEntries        = [];
let transportEntries = [];
let data, globalFont, globalFontB;

// ─── UI wiring ───────────────────────────────────────────────────────────────
const dropArea       = document.getElementById('drop-area');
const fileInput      = document.getElementById('fileInput');
const fileList       = document.getElementById('file-list');
const mergeBtn       = document.getElementById('merge-btn');
const removeAllBtn   = document.getElementById('remove-all-btn');
const outputFilename = document.getElementById('outputFilename');

dropArea.addEventListener('dragover', e => {
  e.preventDefault(); dropArea.classList.add('dragover');
});
dropArea.addEventListener('dragleave', () => {
  dropArea.classList.remove('dragover');
});
dropArea.addEventListener('drop', e => {
  e.preventDefault();
  dropArea.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
  for (let f of files) {
    if (f.type === 'application/pdf') pdfFiles.push(f);
  }
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';
  pdfFiles.forEach((f, i) => {
    const name = f.name.replace(/\.pdf$/i,'');
    const div  = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <span class="file-name">${name}</span>
      <span class="file-actions">
        <button onclick="previewPDF(${i})">Preview</button>
        <button class="remove" onclick="removePDF(${i})">Remove</button>
      </span>`;
    fileList.appendChild(div);
  });
  Sortable.create(fileList, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: evt => {
      const [m] = pdfFiles.splice(evt.oldIndex, 1);
      pdfFiles.splice(evt.newIndex, 0, m);
      renderFileList();
    }
  });
}

function previewPDF(i) {
  window.open(URL.createObjectURL(pdfFiles[i]), '_blank');
}

function removePDF(i) {
  pdfFiles.splice(i,1);
  renderFileList();
}

removeAllBtn.addEventListener('click', () => {
  pdfFiles = [];
  renderFileList();
});

function showOverlay() {
  document.getElementById('loader-overlay').classList.add('show');
}
function hideOverlay() {
  document.getElementById('loader-overlay').classList.remove('show');
}

mergeBtn.addEventListener('click', async () => {
  if (!pdfFiles.length) {
    return alert('Please select PDF files first.');
  }
  const dt = new DataTransfer();
  pdfFiles.forEach(f => dt.items.add(f));
  fileInput.files = dt.files;
  showOverlay();
  try {
    await generatePDF();
  } finally {
    hideOverlay();
  }
});

// ─── drawing helpers ─────────────────────────────────────────────────────────
function drawText(pg, txt, x, y, size=9, font=globalFont) {
  pg.drawText(txt, { x, y, size, font });
}
function drawLine(pg, x1,y1,x2,y2) {
  pg.drawLine({ start:{x:x1,y:y1}, end:{x:x2,y:y2}, thickness:0.5 });
}
function fillRect(pg, x,y,w,h,color) {
  pg.drawRectangle({ x, y:y-h, width:w, height:h, color });
}
function formatDT(d) {
  const dd = String(d.getDate()).padStart(2,'0'),
        mm = String(d.getMonth()+1).padStart(2,'0'),
        yy = d.getFullYear(),
        hh = String(d.getHours()).padStart(2,'0'),
        mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}
function drawFooter(pg, pgNum, isLast, total) {
  drawText(pg, "Name & signature driver: ................................................", LEFT, ROW_H, 9);
  drawText(pg, `${pgNum}/${total}`, PAGE_W/2-10, ROW_H, 9);
  if (isLast) {
    drawText(pg, "Name & signature of loader: ...........................................", LEFT, ROW_H*2, 9);
    drawText(pg, "Loading remarks: .....................................................", LEFT, ROW_H*3, 9);
  }
}
function drawCellText(pg, txt, x, y, colW, size=7, font=globalFont) {
  const maxW = colW - 4, orig = (txt||'').trim();
  let t = orig, ell = '…';
  while (t.length && font.widthOfTextAtSize(t+ell,size) > maxW) t = t.slice(0,-1);
  if (t.length < orig.length) t += ell;
  drawText(pg, t, x, y, size, font);
}

// ─── barcode generator ───────────────────────────────────────────────────────
async function generateBarcodeDataUrl(text) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, text, {
    format:       'CODE128',
    width:        2,
    height:       40,
    displayValue: false
  });
  return canvas.toDataURL('image/png');
}

// ─── QR extraction ───────────────────────────────────────────────────────────
async function extractQRCodeFromPage(page) {
  const vp  = page.getViewport({ scale: 4 });
  const cvs = document.createElement('canvas');
  cvs.width = vp.width; cvs.height = vp.height;
  const ctx = cvs.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const imgData = ctx.getImageData(0,0,cvs.width,cvs.height);
  const code    = jsQR(imgData.data, imgData.width, imgData.height);
  if (!code) return null;
  const tl = code.location.topLeftCorner, br = code.location.bottomRightCorner;
  const x = tl.x|0, y = tl.y|0, w = (br.x-tl.x)|0, h = (br.y-tl.y)|0;
  const qrC = document.createElement('canvas');
  qrC.width = w; qrC.height = h;
  qrC.getContext('2d').putImageData(ctx.getImageData(x,y,w,h),0,0);
  return qrC.toDataURL('image/png');
}

// ─── PDF parsing & QR + Transport collection ─────────────────────────────────
async function extractFromPDF(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let currentLoadingList = '', currentService = '', prevArr = null;

  for (let p = 1; p <= pdf.numPages; p++) {
    const pg  = await pdf.getPage(p);
    const txt = await pg.getTextContent();
    const items = txt.items.map(it => ({
      str: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5]
    }));
    const flat = items.map(i=>i.str).join(' ');

    // loading list
    const llm = flat.match(/\b(\d{8,})\b/);
    if (llm) currentLoadingList = llm[1];

    // provider & service
    const pm = flat.match(/Logistics service provider:\s*(.*?)\s*Service:/);
    if (pm && !data.provider) data.provider = pm[1].trim();
    const sm = flat.match(/Service:\s*(.+?)(?=\s{2,}|$)/);
    if (sm) currentService = sm[1];
    data.service = data.service || currentService;

    // totals
    data.orders += +((flat.match(/Amount of orders:\s*(\d+)/)||[])[1]||0);
    data.weight += [...flat.matchAll(/([\d,]+)\s*kg/g)]
                     .reduce((s,m)=>s+parseFloat(m[1].replace(',','.')),0);
    data.volume += [...flat.matchAll(/([\d,]+)\s*m³/g)]
                     .reduce((s,m)=>s+parseFloat(m[1].replace(',','.')),0);
    data.huCount += (flat.match(/\b(1\d{8,}|200\d{7,})\b/g)||[]).length;

    // Transport start (DD.MM.YYYY HH:MM)
    const tsMatch = flat.match(/Transport start[:\s]*(\d{2}\.\d{2}\.\d{4}\s*\d{2}:\d{2})/i);
    if (tsMatch) {
      transportEntries.push({
        loadingList:    currentLoadingList,
        transportStart: tsMatch[1]
      });
    }

    // build rows
    const lines = {};
    items.forEach(it => {
      const key = Math.round(it.y/5)*5;
      (lines[key] ||= []).push(it);
    });
    Object.keys(lines).sort((a,b)=>b-a).forEach(key => {
      const rowItems = lines[key].sort((a,b)=>a.x-b.x);
      if (!rowItems.some(it=>it.str.startsWith('DN ')||/^\d{8,}$/.test(it.str))) return;
      const arr = Array(COL_HEADERS.length).fill('');
      arr[0] = currentLoadingList;
      let xx = LEFT;
      for (let i=1; i<COL_HEADERS.length; i++) {
        arr[i] = rowItems
          .filter(it=>it.x>=xx && it.x<xx+COL_WIDTHS[i])
          .map(it=>it.str.trim()).join(' ');
        xx += COL_WIDTHS[i];
      }
      // VALID_CODES logic
      const toks = arr[3].split(/\s+/);
      const idx  = toks.findIndex(t=>VALID_CODES.includes(t.toUpperCase()));
      if (idx!==-1) {
        arr[3] = toks[idx].toUpperCase();
        arr[4] = (toks.slice(idx+1).join(' ')+ ' '+arr[4]).trim();
      }
      if (!arr[3]&& !arr[4] && (arr[5]||arr[6]||arr[7]) && prevArr) {
        arr[3] = prevArr[3];
        arr[4] = prevArr[4];
      }
      arr[3] = arr[3].trim();
      arr[4] = arr[4].trim();
      arr[COL_HEADERS.length-1] = currentService;
      data.rows.push(arr);
      prevArr = arr;
    });

    // extract QR
    const qrUrl = await extractQRCodeFromPage(pg);
    if (qrUrl) {
      qrEntries.push({
        loadingList: currentLoadingList,
        dataUrl:      qrUrl
      });
    }
  }
}

// ─── build + download merged PDF ────────────────────────────────────────────
async function generatePDF() {
  data             = { provider:'', service:'', orders:0, weight:0, volume:0, huCount:0, rows:[] };
  qrEntries        = [];
  transportEntries = [];

  const files = Array.from(fileInput.files);
  if (!files.length) {
    alert('Select at least one PDF');
    return;
  }
  for (let f of files) {
    await extractFromPDF(f);
  }

  // unique services
  const svcSet = new Set(data.rows.map(r=>r[9]).filter(Boolean));
  const svcArr = Array.from(svcSet);

  // create PDF-lib doc
  const pdfDoc = await PDFLib.PDFDocument.create();
  globalFont   = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  globalFontB  = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  const pages = [];
  let page     = pdfDoc.addPage([PAGE_W,PAGE_H]);
  pages.push(page);


        // ─── Header & table as before ─────────────────────────────────────────
        let y = PAGE_H - ROW_H * 3;
        const title = 'Loading List';
        const tW = globalFontB.widthOfTextAtSize(title, 16);
        drawText(page, title, (PAGE_W - tW) / 2, y, 16, globalFontB);
        y -= ROW_H + 2;
        drawText(page, 'ASML Netherlands B.V.', LEFT, y, 10, globalFontB);
        drawText(page, `Creation date: ${formatDT(new Date())}`, PAGE_W - LEFT - 150, y, 10);
        y -= ROW_H;
        const CX = PAGE_W / 2;
        const maxHeaderW = PAGE_W - CX - LEFT;
        drawCellText(page, `Logistics service provider: ${data.provider}`, CX, y, maxHeaderW, 10);
        y -= ROW_H;
        let svcText = svcArr[0] || '';
        if (svcArr.length > 1) {
            const root = svcArr[0].split(' ').slice(0, -1).join(' ');
            const suffs = svcArr.map(s => s.startsWith(root + ' ') ? s.slice(root.length + 1) : s);
            svcText = `${root} ${suffs.join('/')}`;
        }
        drawCellText(page, `Service: ${svcText}`, CX, y, maxHeaderW, 10);
        y -= ROW_H;
        drawText(page, 'Licence plate:', LEFT, y, 10);
        y -= ROW_H;
        drawText(page, 'Remarks:', LEFT, y, 10);
        y -= ROW_H + GAP_AFTER_TOTAL;
        drawText(page, `Orders: ${data.orders}`, LEFT, y, 8);
        drawText(page, `Weight: ${data.weight.toFixed(2)} kg`, LEFT + 200, y, 8);
        drawText(page, `Volume: ${data.volume.toFixed(3)} m³`, LEFT + 360, y, 8);
        drawText(page, `HUs: ${data.huCount}`, LEFT + 520, y, 8);

        // table header
        y -= ROW_H * 0.55 + HEADER_H;
        fillRect(page, LEFT, y + HEADER_H, TABLE_W, HEADER_H, PDFLib.rgb(0.9, 0.9, 0.9));
        let x = LEFT;
        COL_HEADERS.forEach(([h1, h2], i) => {
            drawText(page, h1, x + 2, y + ROW_H * 1.2, 8, globalFontB);
            if (h2) drawText(page, h2, x + 2, y + ROW_H * 0.2, 8, globalFontB);
            x += COL_WIDTHS[i];
        });
        drawLine(page, LEFT, y, LEFT + TABLE_W, y);
        y -= ROW_H * 1.25;

        // table rows & pagination
        for (const row of data.rows) {
            if (y < ROW_H * 4) {
                page = pdfDoc.addPage([PAGE_W, PAGE_H]);
                pages.push(page);
                y = PAGE_H - ROW_H * 4;
                fillRect(page, LEFT, y + HEADER_H, TABLE_W, HEADER_H, PDFLib.rgb(0.9, 0.9, 0.9));
                x = LEFT;
                COL_HEADERS.forEach(([h1, h2], i) => {
                    drawText(page, h1, x + 2, y + ROW_H * 1.2, 8, globalFontB);
                    if (h2) drawText(page, h2, x + 2, y + ROW_H * 0.2, 8, globalFontB);
                    x += COL_WIDTHS[i];
                });
                drawLine(page, LEFT, y, LEFT + TABLE_W, y);
                y -= ROW_H * 1.25;
            }
            x = LEFT;
            row.forEach((cell, i) => {
                drawCellText(page, cell, x + 2, y, COL_WIDTHS[i]);
                x += COL_WIDTHS[i];
            });
            drawLine(page, LEFT, y - 4, LEFT + TABLE_W, y - 4);
            y -= ROW_H;
        }

        // footers
        pages.forEach((pg, idx) =>
            drawFooter(pg, idx + 1, idx + 1 === pages.length, pages.length)
        );


  // ─── 3-column QR-Index (this is the only block I’ve updated) ────────────────
  if (qrEntries.length) {
    const qrSz     = 60,
          barcodeH = 40,
          rowGap   = ROW_H*1.5,
          titleSz  = 14,
          padW     = 8,
          labelW   = 100,
          blockW   = qrSz + padW*2 + labelW,
          totalW   = PAGE_W - LEFT*2,
          horizGap = (totalW - blockW*3)/2,
          colX     = [ LEFT, LEFT+blockW+horizGap, LEFT+2*(blockW+horizGap) ],
          rowsPer  = Math.floor((PAGE_H - ROW_H*4)/(qrSz+rowGap)),
          perPage  = rowsPer*3,
          yStart   = PAGE_H - ROW_H*3;

    for (let pageIdx=0; pageIdx*perPage<qrEntries.length; pageIdx++) {
      const idxPg = pdfDoc.addPage([PAGE_W,PAGE_H]);

      // page title
      const qrTitle = 'QR Codes for Scanning';
      const tW      = globalFontB.widthOfTextAtSize(qrTitle, titleSz);
      drawText(idxPg, qrTitle, (PAGE_W-tW)/2, PAGE_H-ROW_H*1.5, titleSz, globalFontB);

      const chunk = qrEntries.slice(pageIdx*perPage, pageIdx*perPage+perPage);
      for (let i=0; i<chunk.length; i++) {
        const { loadingList, dataUrl } = chunk[i];
        const col = i%3, row = Math.floor(i/3);
        const xPos = colX[col], yPos = yStart - row*(qrSz+rowGap);

        // border box
        idxPg.drawRectangle({
          x: xPos-padW, y:(yPos-qrSz)-4,
          width: blockW, height: qrSz+8,
          borderColor: PDFLib.rgb(0.5,0.5,0.5),
          borderWidth: 0.7
        });

        // QR
        const b64qr = dataUrl.split(',')[1];
        const pngQr = await pdfDoc.embedPng(
          Uint8Array.from(atob(b64qr), c=>c.charCodeAt(0))
        );
        idxPg.drawImage(pngQr, {
          x:      xPos,
          y:      yPos-qrSz,
          width:  qrSz,
          height: qrSz
        });

        // Transport start (two lines)
        const te    = transportEntries.find(e=>e.loadingList===loadingList);
        const textX = xPos + qrSz + 10;
        const line1Y = yPos - 10;
        drawText(idxPg, 'Transport start:', textX, line1Y, 8, globalFont);
        drawText(idxPg, te?.transportStart||'', textX, line1Y-10, 8, globalFont);

        // Barcode
        const b64bc = (await generateBarcodeDataUrl(loadingList)).split(',')[1];
        const pngBc = await pdfDoc.embedPng(
          Uint8Array.from(atob(b64bc), c=>c.charCodeAt(0))
        );
        const bcX = xPos + qrSz + padW;
        idxPg.drawImage(pngBc, {
          x:      bcX,
          y:      yPos-qrSz + (qrSz-barcodeH)/2,
          width:  qrSz*1.5,
          height: barcodeH
        });

        // Shipment ID (bold) below barcode
        drawText(idxPg, loadingList, bcX, yPos-qrSz-5, 8, globalFontB);
      }
    }
  }

  // save & download
  const bytes = await pdfDoc.save();
  const blob  = new Blob([bytes], { type:'application/pdf' });
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = outputFilename.value.trim() + '.pdf';
  a.click();
}
