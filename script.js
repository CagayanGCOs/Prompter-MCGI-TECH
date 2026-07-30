(function(){
  const canvas = document.getElementById('stageCanvas');
  const ctx = canvas.getContext('2d', { alpha:false, desynchronized:true });
  const MAX_CONTENT_H = 24000; // hard cap so huge images/scripts don't blow up memory/GPU

  const state = {
    mode: 'text',
    playing: false,
    speed: 1.0,
    scrollY: 0,
    fontSize: 48,
    canvasW: 1920,
    canvasH: 1080,
    contentCanvas: null,
    contentH: 0,
    lastTime: null,
    recording: false,
    mediaRecorder: null,
    chunks: []
  };

  const BASE_SPEED = 90; // px per second at 1.0x

  function fitCanvasToScreen(){
    canvas.width = state.canvasW;
    canvas.height = state.canvasH;
    const maxW = window.innerWidth - 340;
    const maxH = window.innerHeight - 90;
    const scale = Math.min(maxW / state.canvasW, maxH / state.canvasH, 1);
    canvas.style.width = (state.canvasW * scale) + 'px';
    canvas.style.height = (state.canvasH * scale) + 'px';
  }
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitCanvasToScreen, 120);
  });

  document.getElementById('resPreset').addEventListener('change', (e)=>{
    const v = e.target.value;
    document.getElementById('customRes').style.display = v === 'custom' ? 'grid' : 'none';
    if(v === '1920x1080'){ state.canvasW=1920; state.canvasH=1080; }
    else if(v === '1280x720'){ state.canvasW=1280; state.canvasH=720; }
    applyResize();
  });
  document.getElementById('customW').addEventListener('input', (e)=>{
    state.canvasW = parseInt(e.target.value)||1080; applyResize();
  });
  document.getElementById('customH').addEventListener('input', (e)=>{
    state.canvasH = parseInt(e.target.value)||1920; applyResize();
  });

  function applyResize(){
    fitCanvasToScreen();
    rebuildContent();
    resetScroll();
  }

  document.querySelectorAll('.tabbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.tab;
      document.getElementById('panel-text').style.display = state.mode==='text' ? 'block':'none';
      document.getElementById('panel-image').style.display = state.mode==='image' ? 'block':'none';
      document.getElementById('fontGroup').style.display = state.mode==='text' ? 'flex':'none';
      rebuildContent();
      resetScroll();
    });
  });

  let textDebounce = null;
  document.getElementById('textInput').addEventListener('input', ()=>{
    if(state.mode!=='text') return;
    clearTimeout(textDebounce);
    textDebounce = setTimeout(()=>{ rebuildContent(); resetScroll(); }, 220);
  });

  let loadedImage = null;
  document.getElementById('imageInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const img = new Image();
    img.onload = ()=>{
      loadedImage = img;

      // auto width: match the canvas to the image's native width so nothing stretches or blurs
      state.canvasW = img.naturalWidth;
      document.getElementById('resPreset').value = 'custom';
      document.getElementById('customRes').style.display = 'grid';
      document.getElementById('customW').value = state.canvasW;

      applyResize();
    };
    img.src = URL.createObjectURL(file);
  });

  let fontDebounce = null;
  document.getElementById('fontSize').addEventListener('input', (e)=>{
    state.fontSize = parseInt(e.target.value);
    document.getElementById('fontSizeVal').textContent = state.fontSize+'px';
    if(state.mode!=='text') return;
    clearTimeout(fontDebounce);
    fontDebounce = setTimeout(()=>{ rebuildContent(); resetScroll(); }, 150);
  });

  document.querySelectorAll('.speedbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.speedbtn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.speed = parseFloat(btn.dataset.speed);
    });
  });

  function rebuildContent(){
    const off = document.createElement('canvas');
    off.width = state.canvasW;

    if(state.mode === 'image' && loadedImage){
      const w = state.canvasW;
      let h = loadedImage.height * (w / loadedImage.width);
      if(h > MAX_CONTENT_H){ h = MAX_CONTENT_H; } // avoid oversized canvas causing GPU/memory lag
      off.height = h;
      const octx = off.getContext('2d', { alpha:false });
      octx.drawImage(loadedImage, 0, 0, w, loadedImage.height * (w / loadedImage.width));
      state.contentH = h;
    } else {
      const octx0 = off.getContext('2d');
      const fs = state.fontSize;
      octx0.font = fs+'px Georgia, serif';
      const text = document.getElementById('textInput').value || '';
      const paragraphs = text.split('\n');
      const maxLineW = state.canvasW * 0.82;
      const lines = [];
      paragraphs.forEach(p=>{
        if(p.trim()===''){ lines.push(''); return; }
        const words = p.split(' ');
        let cur = '';
        words.forEach(w=>{
          const test = cur ? cur+' '+w : w;
          if(octx0.measureText(test).width > maxLineW && cur){
            lines.push(cur); cur = w;
          } else { cur = test; }
        });
        if(cur) lines.push(cur);
      });
      const lineH = fs * 1.5;
      const totalH = Math.min(lines.length * lineH + fs*4, MAX_CONTENT_H);
      off.height = totalH;
      const octx = off.getContext('2d', { alpha:false });
      octx.fillStyle = '#000';
      octx.fillRect(0,0,off.width,off.height);
      octx.font = fs+'px Georgia, serif';
      octx.fillStyle = '#f4efe2';
      octx.textAlign = 'center';
      octx.textBaseline = 'top';
      lines.forEach((line, i)=>{
        octx.fillText(line, off.width/2, fs*2 + i*lineH);
      });
      state.contentH = totalH;
    }
    state.contentCanvas = off;
  }

  function resetScroll(){
    state.scrollY = 0; // show content immediately instead of a blank frame that needs scrolling into view
    state.lastTime = null;
    drawFrame();
    updateScrub();
  }

  function updateScrub(){
    const total = Math.max(1, state.contentH);
    const progress = Math.min(1, Math.max(0, state.scrollY / total));
    document.getElementById('scrubFill').style.width = (progress*100)+'%';
  }

  function drawFrame(){
    ctx.fillStyle = '#050505';
    ctx.fillRect(0,0,canvas.width, canvas.height);
    if(state.contentCanvas){
      ctx.drawImage(state.contentCanvas, 0, -state.scrollY);
    }
  }

  let frameCount = 0;
  function tick(ts){
    if(state.playing){
      if(state.lastTime == null) state.lastTime = ts;
      const dt = (ts - state.lastTime) / 1000;
      state.lastTime = ts;
      state.scrollY += BASE_SPEED * state.speed * dt;
      const maxScroll = state.contentH;
      if(state.scrollY >= maxScroll){
        state.scrollY = maxScroll;
        setPlaying(false);
      }
      drawFrame();
      frameCount++;
      if(frameCount % 3 === 0) updateScrub(); // scroll stays 60fps; progress bar updates ~20x/sec, plenty smooth
    } else {
      state.lastTime = null;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const playBtn = document.getElementById('playBtn');

  function setPlaying(val){
    state.playing = val;
    playBtn.textContent = val ? '❚❚ Pause' : '▶ Play';
  }
  playBtn.addEventListener('click', ()=> setPlaying(!state.playing));

  document.getElementById('replayBtn').addEventListener('click', ()=>{
    setPlaying(false);
    resetScroll();
  });

  window.addEventListener('keydown', (e)=>{
    if(e.code === 'Space'){
      const tag = document.activeElement.tagName;
      if(tag === 'TEXTAREA' || tag === 'INPUT') return;
      e.preventDefault();
      setPlaying(!state.playing);
    }
  });

  const recBtn = document.getElementById('recBtn');
  recBtn.addEventListener('click', ()=>{
    if(!state.recording){
      startRecording();
    } else {
      stopRecording();
    }
  });

  function startRecording(){
    const fps = parseInt(document.getElementById('recFps').value) || 30;
    const stream = canvas.captureStream(fps);
    const bitrate = Math.round(4_000_000 * (state.canvasW*state.canvasH)/(1920*1080)); // scale bitrate to resolution
    let options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bitrate };
    if(!MediaRecorder.isTypeSupported(options.mimeType)){
      options = { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: bitrate };
    }
    if(!MediaRecorder.isTypeSupported(options.mimeType)){
      options = { mimeType: 'video/webm', videoBitsPerSecond: bitrate };
    }
    state.chunks = [];
    state.mediaRecorder = new MediaRecorder(stream, options);
    state.mediaRecorder.ondataavailable = (e)=>{
      if(e.data && e.data.size>0) state.chunks.push(e.data);
    };
    state.mediaRecorder.onstop = ()=>{
      const blob = new Blob(state.chunks, {type:'video/webm'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prompter-recording-'+Date.now()+'.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 3000);
    };
    state.mediaRecorder.start();
    state.recording = true;
    recBtn.textContent = '■ Stop recording';
    recBtn.classList.add('on');
  }

  function stopRecording(){
    if(state.mediaRecorder && state.mediaRecorder.state !== 'inactive'){
      state.mediaRecorder.stop();
    }
    state.recording = false;
    recBtn.textContent = '● Record screen';
    recBtn.classList.remove('on');
  }

  fitCanvasToScreen();
  rebuildContent();
  resetScroll();

  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    });
  }
})();
