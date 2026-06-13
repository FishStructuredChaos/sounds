(function () {
    'use strict';

    const DOM = {
        soundboard: document.getElementById('soundboard'),
        loading: document.getElementById('loading'),
        randomBtn: document.getElementById('random-btn'),
        totalCount: document.getElementById('total-count'),
        controlsBar: document.getElementById('controls-bar'),
        searchInput: document.getElementById('search-input'),
        volumeSlider: document.getElementById('volume-slider'),
        speedSlider: document.getElementById('speed-slider'),
        speedValue: document.getElementById('speed-value'),
        speedReset: document.getElementById('speed-reset'),
        pitchSlider: document.getElementById('pitch-slider'),
        pitchValue: document.getElementById('pitch-value'),
        distSlider: document.getElementById('distortion-slider'),
        distValue: document.getElementById('distortion-value'),
        distReset: document.getElementById('dist-reset'),
        pitchReset: document.getElementById('pitch-reset'),
        stopBtn: document.getElementById('stop-btn'),
        hideControlsBtn: document.getElementById('hide-controls-btn'),
        unloopBtn: document.getElementById('unloop-btn'),
        bassBtn: document.getElementById('bass-btn'),
        eqBtn: document.getElementById('eq-btn'),
        eqPanel: document.getElementById('eq-panel'),
        eqCanvas: document.getElementById('eq-canvas'),
        eqTooltip: document.getElementById('eq-tooltip'),
        eqReset: document.getElementById('eq-reset'),
        eqQSlider: document.getElementById('eq-q-slider'),
        eqQVal: document.getElementById('eq-q-val'),
        eqQRow: document.getElementById('eq-q-row'),
        autoPitchBtn: document.getElementById('auto-pitch-btn'),
        nowPlaying: document.getElementById('now-playing'),
        loadBtn: document.getElementById('load-btn'),
        limiterValue: document.getElementById('limiter-value'),
        limiterReset: document.getElementById('limiter-reset'),
    };

    let allSounds = [];
    let activeAudios = [];
    let audioCtx = null;
    let masterGain = null;
    let bassFilter = null;
    let bassBoostOn = false;
    let eqFilters = [];
    let autoPitchOn = false;
    let autoPitchSpeed = 1;
    let autoPitchMode = 0;
    let autoPitchModes = ['RND', 'STEP', 'DRIFT'];
    let eqBuilt = false;
    let eqCanvasCtx = null;
    let analyser = null;
    let freqDataArray = null;
    let eqAnimating = false;
    let dragBand = -1;
    let selectedBand = -1;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartFreq = 0;
    let dragStartGain = 0;
    let eqBands = [];
    let paintLooping = null;
    let paintLoopDrag = false;
    let paintPlaying = null;
    let paintPlayDrag = false;
    let pointerStart = null;
    let minFreq = 20;
    let maxFreq = 20000;
    let localCatCounter = 0;
    let baseTotal = 0;
    let importDB = null;

    function openImportDB() {
        return new Promise(function (resolve, reject) {
            if (importDB) { resolve(importDB); return; }
            var req = indexedDB.open('SoundboardImports', 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains('files')) {
                    var store = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('category', 'category', { unique: false });
                }
            };
            req.onsuccess = function () {
                importDB = req.result;
                resolve(importDB);
            };
            req.onerror = function () { reject(req.error); };
        });
    }

    function saveImportsToDB(files, catName) {
        return openImportDB().then(function (db) {
            var tx = db.transaction('files', 'readwrite');
            var store = tx.objectStore('files');
            for (var i = 0; i < files.length; i++) {
                store.add({ name: files[i].name, data: files[i], category: catName, timestamp: Date.now() });
            }
        }).catch(function () {});
    }

    function clearImportDB() {
        return openImportDB().then(function (db) {
            var tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').clear();
        }).catch(function () {});
    }

    function restoreImports() {
        openImportDB().then(function (db) {
            var tx = db.transaction('files', 'readonly');
            var req = tx.objectStore('files').getAll();
            req.onsuccess = function () {
                var entries = req.result;
                if (!entries || entries.length === 0) return;
                var groups = {};
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    var g = e.category || '📂 MY SOUNDS';
                    if (!groups[g]) groups[g] = [];
                    groups[g].push(e.data);
                }
                for (var g in groups) {
                    loadLocalFiles(groups[g], g, true);
                }
            };
        }).catch(function () {});
    }

    function updateSliderModified(el) {
        if (!el || el.disabled) return;
        var modified = el.value !== el.defaultValue;
        el.classList.toggle('modified', modified);
        var resetBtn = el.parentNode.querySelector('.mini-btn');
        if (resetBtn) {
            resetBtn.classList.toggle('reset-active', modified);
        }
    }

    function posX(freq) {
        return (Math.log(freq / minFreq) / Math.log(maxFreq / minFreq)) * (DOM.eqCanvas ? (DOM.eqCanvas.width / (window.devicePixelRatio || 1)) : 200);
    }
    function posY(db) {
        var h = DOM.eqCanvas ? (DOM.eqCanvas.height / (window.devicePixelRatio || 1)) : 100;
        var n = (db + 50) / 100;
        if (n < 0) n = 0;
        if (n > 1) n = 1;
        return h * (1 - n);
    }

    // EQ fun modes state
    let wobbleOn = false;
    let wobbleSpeed = 1;
    let chaosOn = false;


    let bufferCache = {};
    let distortionNode = null;
    let limiterNode = null;
    var webAudioOk = true;

    function getAudioCtx() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                bassFilter = audioCtx.createBiquadFilter();
                bassFilter.type = 'lowshelf';
                bassFilter.frequency.value = 80;
                bassFilter.gain.value = 0;
                masterGain = audioCtx.createGain();
                masterGain.gain.value = parseFloat(DOM.volumeSlider.value);
                eqFilters = [];
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = 0.85;
                analyser.minDecibels = -100;
                analyser.maxDecibels = 0;
                freqDataArray = new Float32Array(analyser.frequencyBinCount);
                distortionNode = audioCtx.createWaveShaper();
                distortionNode.curve = null;
                limiterNode = audioCtx.createDynamicsCompressor();
                limiterNode.threshold.value = 0;
                limiterNode.knee.value = 0;
                limiterNode.ratio.value = 20;
                limiterNode.attack.value = 0.001;
                limiterNode.release.value = 0.05;
                bassFilter.connect(masterGain);
                masterGain.connect(distortionNode);
                distortionNode.connect(limiterNode);
                limiterNode.connect(analyser);
                analyser.connect(audioCtx.destination);
            } catch (e) {
                webAudioOk = false;
                return null;
            }
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(function () {});
        }
        return audioCtx;
    }

    function start() {
        var data = window.SOUND_CONFIG;

        if (!data || Object.keys(data).length === 0) {
            DOM.loading.textContent = '⚠ ERROR: Failed to load sounds. Check config.json ⚠';
            return;
        }

        DOM.loading.style.display = 'none';
        DOM.controlsBar.style.display = 'flex';
        buildSoundboard(data);
        bindControls();
    }

    function buildSoundboard(data) {
        var total = 0;
        var firstCat = null;

        for (var folderName in data) {
            if (!data.hasOwnProperty(folderName)) continue;
            var files = data[folderName];
            total += files.length;

            var category = document.createElement('div');
            category.className = 'category-container';

            var title = document.createElement('h2');
            title.className = 'category-title';

            var titleLeft = document.createElement('span');
            titleLeft.className = 'category-title-left';

            var collapseIcon = document.createElement('span');
            collapseIcon.className = 'collapse-icon';
            collapseIcon.textContent = '▼';

            var titleText = document.createElement('span');
            titleText.className = 'category-title-text';
            titleText.textContent = folderName;

            titleLeft.appendChild(collapseIcon);
            titleLeft.appendChild(titleText);

            var countSpan = document.createElement('span');
            countSpan.className = 'folder-count';
            countSpan.textContent = '[' + files.length + ' sounds]';

            var grid = document.createElement('div');
            grid.className = 'buttons-grid collapsed';

            category._files = files;
            category._loaded = false;

            title.appendChild(titleLeft);
            title.appendChild(countSpan);
            category.appendChild(title);

            category.addEventListener('click', function (e) {
                if (!e.target.closest('.category-title')) return;
                var cat = e.currentTarget;
                var g = cat.querySelector('.buttons-grid');
                var t = cat.querySelector('.category-title');
                t.classList.toggle('collapsed');
                g.classList.toggle('collapsed');

                if (!cat._loaded && !g.classList.contains('collapsed')) {
                    cat._loaded = true;
                    populateCategoryGrid(cat);
                }
            });

            category.appendChild(grid);
            DOM.soundboard.appendChild(category);
            if (!firstCat) firstCat = category;

            // Category enable/disable toggle
            (function (catEl, gridEl, btnEl, catName) {
                btnEl.className = 'cat-toggle';
                btnEl.textContent = 'DISABLE';
                btnEl.title = 'Disable this category';
                title.appendChild(btnEl);

                try {
                    var dc = JSON.parse(localStorage.getItem('disabledCategories') || '[]');
                    if (dc.indexOf(catName) !== -1) {
                        catEl.classList.add('cat-disabled');
                        btnEl.textContent = 'ENABLE';
                        btnEl.classList.add('enable-state');
                        gridEl.style.display = 'none';
                    }
                } catch (e) {}

                btnEl.onclick = function (e) {
                    e.stopPropagation();
                    catEl.classList.toggle('cat-disabled');
                    var isDisabled = catEl.classList.contains('cat-disabled');
                    this.textContent = isDisabled ? 'ENABLE' : 'DISABLE';
                    this.classList.toggle('enable-state', isDisabled);
                    gridEl.style.display = isDisabled ? 'none' : '';
                    if (isDisabled) {
                        DOM.soundboard.appendChild(catEl);
                    } else {
                        var disabled = DOM.soundboard.querySelectorAll('.category-container.cat-disabled');
                        if (disabled.length > 0) {
                            DOM.soundboard.insertBefore(catEl, disabled[0]);
                        } else {
                            DOM.soundboard.appendChild(catEl);
                        }
                    }
                    try {
                        var arr = JSON.parse(localStorage.getItem('disabledCategories') || '[]');
                        var idx = arr.indexOf(catName);
                        if (isDisabled && idx === -1) arr.push(catName);
                        else if (!isDisabled && idx !== -1) arr.splice(idx, 1);
                        localStorage.setItem('disabledCategories', JSON.stringify(arr));
                    } catch (e) {}
                };
            })(category, grid, document.createElement('button'), folderName);
        }

        // Move disabled categories to bottom
        var allCats = Array.prototype.slice.call(DOM.soundboard.children);
        var enabled = allCats.filter(function (c) { return !c.classList.contains('cat-disabled'); });
        var disabled = allCats.filter(function (c) { return c.classList.contains('cat-disabled'); });
        enabled.concat(disabled).forEach(function (c) { DOM.soundboard.appendChild(c); });

        baseTotal = total;
        updateTotalCount();

        if (firstCat) {
            var g = firstCat.querySelector('.buttons-grid');
            var t = firstCat.querySelector('.category-title');
            t.classList.remove('collapsed');
            g.classList.remove('collapsed');
            firstCat._loaded = true;
            populateCategoryGrid(firstCat);
        }
    }

    function populateCategoryGrid(category) {
        var files = category._files;
        var grid = category.querySelector('.buttons-grid');
        var folderName = category.querySelector('.category-title-text').textContent;

        files.forEach(function (file) {
            var fileName = file, fileSize = 0;
            if (Array.isArray(file)) { fileName = file[0]; fileSize = file[1] || 0; }
            else if (typeof file === 'object') { fileName = file.name || ''; fileSize = file.size || 0; }

            var audioPath = 'audio/' + folderName + '/' + fileName;

            var btn = document.createElement('button');
            btn.className = 'sound-btn';

            var cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
            btn.textContent = cleanName;
            btn.dataset.search = cleanName;
            btn.dataset.path = audioPath;
            var len = cleanName.length;
            if (len <= 5) btn.style.fontSize = '1.3rem';
            else if (len <= 9) btn.style.fontSize = '1.0rem';
            else if (len <= 14) btn.style.fontSize = '0.85rem';
            else if (len <= 22) btn.style.fontSize = '0.7rem';
            else btn.style.fontSize = '0.6rem';

            if (fileSize > 0) {
                var sizeText = document.createElement('span');
                sizeText.className = 'file-size';
                if (fileSize < 1024) sizeText.textContent = fileSize + ' B';
                else if (fileSize < 1048576) sizeText.textContent = (fileSize / 1024).toFixed(0) + ' KB';
                else sizeText.textContent = (fileSize / 1048576).toFixed(1) + ' MB';
                btn.appendChild(sizeText);
            }

            allSounds.push(audioPath);

            var downloadBtn = document.createElement('a');
            downloadBtn.className = 'download-btn';
            downloadBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1a.5.5 0 0 1 .5.5v7.793l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V1.5A.5.5 0 0 1 8 1z"/><path d="M1 11.5a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 1 1 0v2a1.5 1.5 0 0 1-1.5 1.5H2a1.5 1.5 0 0 1-1.5-1.5v-2a.5.5 0 0 1 .5-.5z"/></svg>';
            downloadBtn.href = audioPath;
            downloadBtn.download = fileName;
            downloadBtn.title = 'Download';

            var stopBtn = document.createElement('button');
            stopBtn.className = 'stop-single-btn';
            stopBtn.textContent = '✕';
            stopBtn.title = 'Stop this sound';

            var loopBtn = document.createElement('button');
            loopBtn.className = 'loop-btn';
            loopBtn.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor"><path d="M15.5 2.5A1 1 0 0 1 16 4v3a1 1 0 0 1-1 1h-3a1 1 0 0 1 0-2h1.2A5.5 5.5 0 0 0 4.9 6.6a1 1 0 1 1-1.8-.8A7.5 7.5 0 0 1 15.5 4V3.5a1 1 0 0 1 1-1zM3.5 17A1 1 0 0 1 3 15.5v-3A1 1 0 0 1 4 11.5h3a1 1 0 0 1 0 2H5.8A5.5 5.5 0 0 0 15.1 13a1 1 0 0 1 1.8.8A7.5 7.5 0 0 1 4.5 16v.5a1 1 0 0 1-1 1z"/></svg>';
            loopBtn.title = 'Toggle loop';
            loopBtn.dataset.loop = 'false';

            var progressTrack = document.createElement('span');
            progressTrack.className = 'progress-track';
            var progressFill = document.createElement('span');
            progressFill.className = 'progress-fill';
            progressTrack.appendChild(progressFill);

            var skipBack = document.createElement('button');
            skipBack.className = 'skip-btn skip-back';
            skipBack.textContent = '-10';
            skipBack.title = 'Skip back 10s';

            var skipForward = document.createElement('button');
            skipForward.className = 'skip-btn skip-forward';
            skipForward.textContent = '+10';
            skipForward.title = 'Skip forward 10s';

            btn.appendChild(stopBtn);
            btn.appendChild(loopBtn);
            btn.appendChild(progressTrack);
            btn.appendChild(skipBack);
            btn.appendChild(skipForward);
            btn.appendChild(downloadBtn);

            btn.addEventListener('click', function (e) {
                if (e.target === downloadBtn) return;
                if (e.target === stopBtn) {
                    stopSingle(btn);
                    return;
                }
                if (e.target === loopBtn || loopBtn.contains(e.target)) {
                    if (!paintLoopDrag) toggleLoop(btn, loopBtn);
                    paintLoopDrag = false;
                    paintPlayDrag = false;
                    return;
                }
                if (e.target === skipBack || e.target === skipForward) {
                    var delta = e.target === skipBack ? -10 : 10;
                    skipSound(btn, delta);
                    return;
                }
                if (paintPlayDrag) { paintPlayDrag = false; return; }
                playSound(audioPath, btn);
            });

            grid.appendChild(btn);
        });
    }

    function loadAllCategories() {
        var cats = document.querySelectorAll('.category-container');
        for (var i = 0; i < cats.length; i++) {
            var cat = cats[i];
            if (!cat._loaded) {
                cat._loaded = true;
                populateCategoryGrid(cat);
            }
        }
    }

    function bindControls() {
        DOM.randomBtn.addEventListener('click', function () {
            loadAllCategories();
            var disabledCats = [];
            try { disabledCats = JSON.parse(localStorage.getItem('disabledCategories') || '[]'); } catch (e) {}
            var available = allSounds.filter(function (p) {
                var parts = p.split('/');
                if (parts[0] === 'audio') {
                    return disabledCats.indexOf(parts[1]) === -1;
                }
                var btn = Array.prototype.find.call(document.querySelectorAll('.sound-btn'), function (b) { return b.dataset.path === p; });
                return btn && !btn.closest('.cat-disabled');
            });
            if (available.length > 0) {
                var path = available[Math.floor(Math.random() * available.length)];
                var btn = Array.prototype.find.call(document.querySelectorAll('.sound-btn'), function (b) { return b.dataset.path === path; });
                playSound(path, btn || DOM.randomBtn);
            }
        });

        DOM.stopBtn.addEventListener('click', stopAll);

        DOM.volumeSlider.addEventListener('input', function () {
            updateSliderModified(this);
            var vol = parseFloat(DOM.volumeSlider.value);
            if (masterGain) {
                masterGain.gain.value = vol;
            }
            for (var i = 0; i < activeAudios.length; i++) {
                if (activeAudios[i].audio) {
                    activeAudios[i].audio.volume = vol;
                }
            }
        });

        DOM.speedSlider.addEventListener('input', function () {
            updateSliderModified(this);
            DOM.speedValue.textContent = parseFloat(DOM.speedSlider.value).toFixed(2);
            updateActiveRates();
        });
        DOM.speedReset.addEventListener('click', function () {
            DOM.speedSlider.value = '1';
            DOM.speedValue.textContent = '1.00';
            updateActiveRates();
            updateSliderModified(DOM.speedSlider);
        });

        DOM.pitchSlider.addEventListener('input', function () {
            updateSliderModified(this);
            DOM.pitchValue.textContent = parseInt(DOM.pitchSlider.value) + '¢';
            updateActiveRates();
        });
        DOM.pitchReset.addEventListener('click', function () {
            DOM.pitchSlider.value = '0';
            DOM.pitchValue.textContent = '0¢';
            updateActiveRates();
            updateSliderModified(DOM.pitchSlider);
        });

        function makeDistortionCurve(amount) {
            var samples = 256;
            var curve = new Float32Array(samples);
            var k = amount / 100 * 200;
            for (var i = 0; i < samples; i++) {
                var x = (i * 2) / samples - 1;
                curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
            }
            return curve;
        }

        var limiterThreshold = 0;

        function updateLimiter() {
            if (limiterNode) {
                limiterNode.threshold.value = limiterThreshold;
            }
        }

        DOM.distSlider.addEventListener('input', function () {
            updateSliderModified(this);
            var val = parseInt(DOM.distSlider.value);
            DOM.distValue.textContent = val;
            if (distortionNode) {
                distortionNode.curve = val > 0 ? makeDistortionCurve(val) : null;
            }
        });
        DOM.distReset.addEventListener('click', function () {
            DOM.distSlider.value = '0';
            DOM.distValue.textContent = '0';
            if (distortionNode) distortionNode.curve = null;
            updateSliderModified(DOM.distSlider);
        });

        DOM.bassBtn.addEventListener('click', function () {
            bassBoostOn = !bassBoostOn;
            DOM.bassBtn.classList.toggle('active', bassBoostOn);
            DOM.bassBtn.textContent = bassBoostOn ? '💥 BASS' : '🔊 BASS';
            if (bassFilter) {
                bassFilter.gain.value = bassBoostOn ? 28 : 0;
            }
        });

        DOM.eqBtn.addEventListener('click', function () {
            if (DOM.eqPanel.style.display === 'none') {
                if (!eqBuilt) {
                    buildEqPanel();
                    eqBuilt = true;
                } else {
                    startEqAnimation();
                }
                DOM.eqPanel.style.display = 'block';
                DOM.eqBtn.classList.add('active');
                resizeEqCanvas();
            } else {
                DOM.eqPanel.style.display = 'none';
                DOM.eqBtn.classList.remove('active');
                stopEqAnimation();
            }
        });

        DOM.eqReset.addEventListener('click', function () {
            wobbleOn = false; chaosOn = false;
            if (DOM.eqWobble) DOM.eqWobble.classList.remove('active');
            if (DOM.eqChaos) DOM.eqChaos.classList.remove('active');
            if (DOM.wobbleRow) DOM.wobbleRow.style.display = 'none';
            if (DOM.eqExtras) DOM.eqExtras.style.display = 'none';
            eqBands.forEach(function (b) {
                if (b.filter) try { b.filter.disconnect(); } catch (e) {}
            });
            eqBands = [];
            eqFilters = [];
            // Leave one default dot so audio always routes through the EQ chain
            addEqBand(1000, 0);
            selectedBand = 0;
            if (DOM.eqQRow) {
                DOM.eqQRow.style.display = 'flex';
                DOM.eqQSlider.value = 1;
                DOM.eqQVal.textContent = '0.1';
            }
        });

        DOM.autoPitchSpeed = document.getElementById('auto-pitch-speed');
        DOM.autoPitchSpeedVal = document.getElementById('auto-pitch-speed-val');
        DOM.pitchSpeedWrap = document.getElementById('pitch-speed-wrap');
        DOM.autoPitchModeBtn = document.getElementById('auto-pitch-mode');

        DOM.autoPitchBtn.addEventListener('click', function () {
            autoPitchOn = !autoPitchOn;
            DOM.autoPitchBtn.classList.toggle('active', autoPitchOn);
            if (DOM.pitchSpeedWrap) DOM.pitchSpeedWrap.style.display = autoPitchOn ? 'inline-flex' : 'none';
            DOM.pitchSlider.disabled = autoPitchOn;
            if (autoPitchOn) {
                DOM.pitchSlider.classList.remove('modified');
                startAutoPitch();
            } else {
                stopAutoPitch();
                updateSliderModified(DOM.pitchSlider);
            }
        });
        if (DOM.autoPitchSpeed) {
            DOM.autoPitchSpeed.addEventListener('input', function () {
                updateSliderModified(this);
                autoPitchSpeed = parseInt(this.value);
                if (DOM.autoPitchSpeedVal) DOM.autoPitchSpeedVal.textContent = this.value;
            });
        }
        if (DOM.autoPitchModeBtn) {
            DOM.autoPitchModeBtn.addEventListener('click', function () {
                autoPitchMode = (autoPitchMode + 1) % autoPitchModes.length;
                this.textContent = autoPitchModes[autoPitchMode];
            });
        }

        var savedLoops = null;
        DOM.unloopBtn.addEventListener('click', function () {
            var loopedBtns = document.querySelectorAll('.loop-btn.loop-active');
            if (loopedBtns.length > 0) {
                savedLoops = [];
                for (var i = 0; i < loopedBtns.length; i++) {
                    var lb = loopedBtns[i];
                    savedLoops.push(lb.parentNode);
                    lb.classList.remove('loop-active');
                    lb.parentNode.dataset.loop = 'false';
                }
                for (var j = 0; j < activeAudios.length; j++) {
                    var entry = activeAudios[j];
                    if (entry.el.dataset.loop === 'false') {
                        if (entry.source) entry.source.loop = false;
                        if (entry.audio) entry.audio.loop = false;
                    }
                }
                DOM.unloopBtn.classList.add('active');
                var ulLabel = DOM.unloopBtn.querySelector('.unloop-label');
                if (ulLabel) ulLabel.textContent = 'OFF';
            } else if (savedLoops) {
                for (var i = 0; i < savedLoops.length; i++) {
                    var btn = savedLoops[i];
                    var lb = btn.querySelector('.loop-btn');
                    if (lb) {
                        lb.classList.add('loop-active');
                        btn.dataset.loop = 'true';
                    }
                }
                for (var j = 0; j < activeAudios.length; j++) {
                    var entry = activeAudios[j];
                    if (entry.el.dataset.loop === 'true') {
                        if (entry.source) entry.source.loop = true;
                        if (entry.audio) entry.audio.loop = true;
                    }
                }
                savedLoops = null;
                DOM.unloopBtn.classList.remove('active');
                var ulLabel = DOM.unloopBtn.querySelector('.unloop-label');
                if (ulLabel) ulLabel.textContent = 'ON';
            }
        });

        DOM.hideControlsBtn.addEventListener('click', function () {
            var bar = DOM.controlsBar;
            if (bar.style.display === 'none') {
                bar.style.display = 'flex';
                DOM.hideControlsBtn.textContent = '▲';
                DOM.hideControlsBtn.title = 'Hide controls';
            } else {
                bar.style.display = 'none';
                DOM.hideControlsBtn.textContent = '▼';
                DOM.hideControlsBtn.title = 'Show controls';
            }
        });

        DOM.searchInput.addEventListener('input', function () {
            loadAllCategories();
            filterSounds();
        });

        var backBtn = document.getElementById('back-to-top');
        backBtn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        window.addEventListener('scroll', function () {
            if (window.scrollY > 300) {
                backBtn.classList.add('visible');
            } else {
                backBtn.classList.remove('visible');
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.code === 'Space' && e.target !== DOM.searchInput) {
                e.preventDefault();
                DOM.randomBtn.click();
            }
        });

        // Painting: drag across buttons to quickly toggle loops or play multiple sounds
        DOM.soundboard.addEventListener('pointerdown', function (e) {
            pointerStart = { x: e.clientX, y: e.clientY };
            var lb = e.target.closest('.loop-btn');
            if (lb) {
                paintLooping = { startBtn: lb.parentNode };
                paintLoopDrag = false;
                return;
            }
            if (e.target.closest('.stop-single-btn, .download-btn, .skip-btn')) return;
            var sb = e.target.closest('.sound-btn');
            if (sb) {
                paintPlaying = { startBtn: sb };
                paintPlayDrag = false;
            }
        });
        DOM.soundboard.addEventListener('pointermove', function (e) {
            if (!pointerStart) return;
            if (!paintLoopDrag && !paintPlayDrag) {
                var dx = e.clientX - pointerStart.x;
                var dy = e.clientY - pointerStart.y;
                if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
            }
            var el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) return;
            var sb = el.closest('.sound-btn');
            if (!sb) return;
            if (paintLooping) {
                if (!paintLoopDrag) {
                    paintLoopDrag = true;
                    toggleLoop(paintLooping.startBtn, paintLooping.startBtn.querySelector('.loop-btn'));
                }
                var loopBtn = sb.querySelector('.loop-btn');
                if (loopBtn && !loopBtn.classList.contains('loop-active')) {
                    toggleLoop(sb, loopBtn);
                }
            }
            if (paintPlaying) {
                if (!paintPlayDrag) {
                    paintPlayDrag = true;
                    playSound(paintPlaying.startBtn.dataset.path, paintPlaying.startBtn);
                }
                if (sb !== paintPlaying.startBtn && !sb.dataset._painted) {
                    sb.dataset._painted = '1';
                    playSound(sb.dataset.path, sb);
                }
            }
        });
        DOM.soundboard.addEventListener('pointerup', function (e) {
            if (paintLooping) {
                paintLooping = null;
            }
            if (paintPlaying) {
                var painted = DOM.soundboard.querySelectorAll('.sound-btn[data-_painted]');
                for (var pi = 0; pi < painted.length; pi++) {
                    painted[pi].removeAttribute('data-_painted');
                }
                paintPlaying = null;
            }
            pointerStart = null;
            setTimeout(function () { paintLoopDrag = false; paintPlayDrag = false; }, 0);
        });

        window.addEventListener('resize', function () {
            if (DOM.eqPanel.style.display !== 'none') {
                resizeEqCanvas();
            }
        });

        // LOAD button: show popup with files/folder choice
        var loadPopup = document.getElementById('load-popup');
        DOM.loadBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            loadPopup.style.display = loadPopup.style.display === 'none' ? 'flex' : 'none';
        });
        document.addEventListener('click', function () {
            loadPopup.style.display = 'none';
        });
        loadPopup.addEventListener('click', function (e) {
            e.stopPropagation();
        });

        function createFileInput(mode) {
            var inp = document.createElement('input');
            inp.type = 'file';
            inp.style.display = 'none';
            if (mode === 'folder') {
                inp.setAttribute('directory', '');
                inp.setAttribute('webkitdirectory', '');
            } else {
                inp.setAttribute('multiple', '');
                inp.setAttribute('accept', 'audio/*');
            }
            inp.addEventListener('change', function () {
                var files = this.files;
                if (!files || files.length === 0) return;
                if (mode === 'folder') {
                    // Group files by subfolder to create separate categories
                    var groups = {};
                    for (var gi = 0; gi < files.length; gi++) {
                        var relPath = files[gi].webkitRelativePath || '';
                        var parts = relPath.split('/');
                        var grpName = parts.length > 1 ? parts[0] : '📂 ROOT';
                        if (!groups[grpName]) groups[grpName] = [];
                        groups[grpName].push(files[gi]);
                    }
                    for (var grp in groups) {
                        loadLocalFiles(groups[grp], grp);
                    }
                } else {
                    loadLocalFiles(files, '📂 MY SOUNDS');
                }
                document.body.removeChild(inp);
            });
            document.body.appendChild(inp);
            inp.click();
        }

        document.getElementById('load-files-opt').addEventListener('click', function () {
            loadPopup.style.display = 'none';
            createFileInput('files');
        });
        document.getElementById('load-folder-opt').addEventListener('click', function () {
            loadPopup.style.display = 'none';
            createFileInput('folder');
        });
        document.getElementById('load-clear-opt').addEventListener('click', function () {
            loadPopup.style.display = 'none';
            clearImportDB().then(function () {
                // Remove all imported categories from the DOM
                var locals = document.querySelectorAll('.category-container[id^="local-cat-"]');
                for (var i = 0; i < locals.length; i++) {
                    locals[i].remove();
                }
                updateTotalCount();
            });
        });

        // Drag and drop: walk dropped entries recursively
        var dropZone = document.getElementById('drop-zone');

        function walkEntry(entry, catName, callback) {
            if (entry.isFile) {
                entry.file(function (file) {
                    if (file.type.indexOf('audio/') === 0 || /\.(wav|mp3|ogg|flac|aac|m4a|wma|opus|webm|aiff|aif|ac3|3gp|amr|ape|dts|mka|ra|rm|voc|pcm|au|snd)$/i.test(file.name)) {
                        callback(file, catName);
                    }
                });
            } else if (entry.isDirectory) {
                var dirName = entry.name || catName;
                var reader = entry.createReader();
                var allEntries = [];
                function readBatch() {
                    reader.readEntries(function (entries) {
                        if (entries.length === 0) {
                            allEntries.forEach(function (e) { walkEntry(e, dirName, callback); });
                        } else {
                            allEntries = allEntries.concat(Array.prototype.slice.call(entries));
                            readBatch();
                        }
                    });
                }
                readBatch();
            }
        }

        function handleDrop(items) {
            var pending = [];
            for (var di = 0; di < items.length; di++) {
                var item = items[di];
                if (item.webkitGetAsEntry) {
                    var entry = item.webkitGetAsEntry();
                    if (entry) {
                        walkEntry(entry, null, function (file, catName) {
                            pending.push({ file: file, catName: catName || '📂 MY SOUNDS' });
                        });
                    }
                } else if (item.getAsFile) {
                    var f = item.getAsFile();
                    if (f) pending.push({ file: f, catName: '📂 MY SOUNDS' });
                }
            }
            // Process after microtask to collect all files
            setTimeout(function () {
                if (pending.length === 0) return;
                var groups = {};
                for (var pi = 0; pi < pending.length; pi++) {
                    var p = pending[pi];
                    var gn = p.catName || '📂 MY SOUNDS';
                    if (!groups[gn]) groups[gn] = [];
                    groups[gn].push(p.file);
                }
                for (var gn in groups) {
                    loadLocalFiles(groups[gn], gn);
                }
            }, 50);
        }

        document.addEventListener('dragenter', function (e) {
            e.preventDefault();
            dropZone.classList.add('visible');
        });
        document.addEventListener('dragover', function (e) {
            e.preventDefault();
        });
        document.addEventListener('dragleave', function (e) {
            if (e.clientX > 0 && e.clientX < window.innerWidth && e.clientY > 0 && e.clientY < window.innerHeight) return;
            dropZone.classList.remove('visible');
        });
        document.addEventListener('drop', function (e) {
            e.preventDefault();
            dropZone.classList.remove('visible');
            if (e.dataTransfer && e.dataTransfer.items) {
                handleDrop(e.dataTransfer.items);
            }
        });

        // Strip limiter
        DOM.limiterMeter = document.getElementById('limiter-meter');
        DOM.limiterMeterCtx = DOM.limiterMeter ? DOM.limiterMeter.getContext('2d') : null;
        DOM.limiterMeterWrap = DOM.limiterMeter ? DOM.limiterMeter.parentNode : null;
        var limiterMeterAnim = null;
        var limiterPeak = 0;

        function resizeLimiterMeter() {
            if (!DOM.limiterMeter) return;
            var rect = DOM.limiterMeterWrap.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            DOM.limiterMeter.width = rect.width * dpr;
            DOM.limiterMeter.height = rect.height * dpr;
            DOM.limiterMeter.style.width = rect.width + 'px';
            DOM.limiterMeter.style.height = rect.height + 'px';
        }

        function drawLimiterMeter() {
            if (!DOM.limiterMeterCtx) return;
            var ctx = DOM.limiterMeterCtx;
            var w = DOM.limiterMeter.width;
            var h = DOM.limiterMeter.height;
            ctx.clearRect(0, 0, w, h);

            // Get peak level from analyser
            var peak = 0;
            if (analyser) {
                var td = new Float32Array(analyser.fftSize);
                try { analyser.getFloatTimeDomainData(td); } catch (e) {}
                for (var i = 0; i < td.length; i++) {
                    var abs = Math.abs(td[i]);
                    if (abs > peak) peak = abs;
                }
            }
            // Convert to dB (0 dBFS = 1.0)
            var peakDB = peak > 0 ? 20 * Math.log10(peak) : -100;
            // Smooth peak hold
            limiterPeak = Math.max(peakDB, limiterPeak - 2);

            // Map dB range [-60, 0] to canvas height
            function dbToY(db) {
                var n = (db + 60) / 60; // 0 at -60dB, 1 at 0dB
                if (n < 0) n = 0;
                if (n > 1) n = 1;
                return h * (1 - n);
            }

            // Draw meter gradient
            var y0 = dbToY(0);
            var y60 = dbToY(-60);
            var grad = ctx.createLinearGradient(0, y0, 0, y60);
            grad.addColorStop(0, '#ff0000');
            grad.addColorStop(0.3, '#ffff00');
            grad.addColorStop(0.6, '#00ff00');
            grad.addColorStop(1, '#003300');
            ctx.fillStyle = grad;
            ctx.fillRect(0, y0, w, y60 - y0);

            // Draw peak level bar
            var peakY = dbToY(limiterPeak);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, peakY, w, Math.max(2, y0 - peakY));

            // Draw threshold line (red)
            var threshY = dbToY(limiterThreshold);
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255,0,0,0.6)';
            ctx.shadowBlur = 3;
            ctx.beginPath();
            ctx.moveTo(0, threshY);
            ctx.lineTo(w, threshY);
            ctx.stroke();
            ctx.shadowBlur = 0;

            limiterMeterAnim = requestAnimationFrame(drawLimiterMeter);
        }

        function startLimiterMeter() {
            resizeLimiterMeter();
            if (limiterMeterAnim) cancelAnimationFrame(limiterMeterAnim);
            drawLimiterMeter();
        }

        function stopLimiterMeter() {
            if (limiterMeterAnim) {
                cancelAnimationFrame(limiterMeterAnim);
                limiterMeterAnim = null;
            }
        }

        // Start limiter meter when it becomes visible
        function updateLimiterResetBtn() {
            if (DOM.limiterReset) {
                DOM.limiterReset.classList.toggle('reset-active', limiterThreshold < 0);
            }
        }

        DOM.limiterReset.addEventListener('click', function () {
            limiterThreshold = 0;
            DOM.limiterValue.textContent = '0.0';
            updateLimiter();
            updateLimiterResetBtn();
        });

        // Click/drag on meter to set threshold
        if (DOM.limiterMeter) {
            DOM.limiterMeter.addEventListener('mousedown', function (e) {
                var rect = this.getBoundingClientRect();
                var y = (e.clientY - rect.top) / rect.height;
                var db = (1 - y) * 60 - 60;
                if (db > 0) db = 0;
                if (db < -40) db = -40;
                limiterThreshold = db;
                DOM.limiterValue.textContent = limiterThreshold.toFixed(1);
                updateLimiter();
                updateLimiterResetBtn();
                startLimiterMeter();

                function onMove(ev) {
                    var r = DOM.limiterMeter.getBoundingClientRect();
                    var yy = (ev.clientY - r.top) / r.height;
                    var dbb = (1 - yy) * 60 - 60;
                    if (dbb > 0) dbb = 0;
                    if (dbb < -40) dbb = -40;
                    limiterThreshold = dbb;
                    DOM.limiterValue.textContent = limiterThreshold.toFixed(1);
                    updateLimiter();
                    updateLimiterResetBtn();
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            // Right-click to enter exact value
            DOM.limiterMeter.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                var val = prompt('Enter threshold (-40 to 0 dB):', limiterThreshold.toFixed(1));
                if (val === null) return;
                var num = parseFloat(val);
                if (isNaN(num)) return;
                if (num > 0) num = 0;
                if (num < -40) num = -40;
                limiterThreshold = num;
                DOM.limiterValue.textContent = limiterThreshold.toFixed(1);
                updateLimiter();
                updateLimiterResetBtn();
                startLimiterMeter();
            });

            // Initialise meter
            updateLimiterResetBtn();
            requestAnimationFrame(function () { startLimiterMeter(); });
        }

        // Initialize slider modified state
        Array.prototype.forEach.call(document.querySelectorAll('input[type="range"]'), updateSliderModified);
    }

    function updateTotalCount() {
        var imported = document.querySelectorAll('.sound-btn[data-local]').length;
        var onlineEl = DOM.totalCount.querySelector('.total-online');
        var localEl = DOM.totalCount.querySelector('.total-local');
        if (onlineEl) onlineEl.textContent = 'ONLINE: ' + baseTotal;
        if (localEl) localEl.textContent = 'LOCAL: ' + imported;
    }

    function loadLocalFiles(files, catName, skipSave) {
        // Reuse existing category with same name, or create new one
        var existingCat = null;
        var allCats = DOM.soundboard.querySelectorAll('.category-container');
        for (var ci = 0; ci < allCats.length; ci++) {
            var tt = allCats[ci].querySelector('.category-title-text');
            if (tt && tt.textContent === catName) {
                existingCat = allCats[ci];
                break;
            }
        }

        var category, grid;
        if (existingCat) {
            category = existingCat;
            grid = category.querySelector('.buttons-grid');
        } else {
            localCatCounter++;
            var catId = 'local-cat-' + localCatCounter;
            category = document.createElement('div');
            category.className = 'category-container';
            category.id = catId;

            var title = document.createElement('h2');
            title.className = 'category-title';
            var titleLeft = document.createElement('span');
            titleLeft.className = 'category-title-left';
            var collapseIcon = document.createElement('span');
            collapseIcon.className = 'collapse-icon';
            collapseIcon.textContent = '▼';
            var titleText = document.createElement('span');
            titleText.className = 'category-title-text';
            titleText.textContent = catName;
            titleLeft.appendChild(collapseIcon);
            titleLeft.appendChild(titleText);
            title.appendChild(titleLeft);

            var countSpan = document.createElement('span');
            countSpan.className = 'folder-count';
            countSpan.textContent = '[' + files.length + ' sounds]';
            title.appendChild(countSpan);

            category.appendChild(title);

            grid = document.createElement('div');
            grid.className = 'buttons-grid';
            category.appendChild(grid);

            category._files = null;
            category._loaded = true;

            title.addEventListener('click', function (e) {
                if (e.target.closest('.cat-toggle') || e.target.closest('.cat-delete')) return;
                var g = category.querySelector('.buttons-grid');
                var t = category.querySelector('.category-title');
                t.classList.toggle('collapsed');
                g.classList.toggle('collapsed');
            });

            // Enable/disable toggle for local categories
            (function (catEl, gridEl, btnEl, catName) {
                btnEl.className = 'cat-toggle';
                btnEl.textContent = 'DISABLE';
                btnEl.title = 'Disable this category';
                title.appendChild(btnEl);

                try {
                    var dc = JSON.parse(localStorage.getItem('disabledCategories') || '[]');
                    if (dc.indexOf(catName) !== -1) {
                        catEl.classList.add('cat-disabled');
                        btnEl.textContent = 'ENABLE';
                        btnEl.classList.add('enable-state');
                        gridEl.style.display = 'none';
                    }
                } catch (e) {}

                btnEl.onclick = function (e) {
                    e.stopPropagation();
                    catEl.classList.toggle('cat-disabled');
                    var isDisabled = catEl.classList.contains('cat-disabled');
                    this.textContent = isDisabled ? 'ENABLE' : 'DISABLE';
                    this.classList.toggle('enable-state', isDisabled);
                    gridEl.style.display = isDisabled ? 'none' : '';
                    if (isDisabled) {
                        DOM.soundboard.appendChild(catEl);
                    } else {
                        var disabled = DOM.soundboard.querySelectorAll('.category-container.cat-disabled');
                        if (disabled.length > 0) {
                            DOM.soundboard.insertBefore(catEl, disabled[0]);
                        } else {
                            DOM.soundboard.appendChild(catEl);
                        }
                    }
                    try {
                        var arr = JSON.parse(localStorage.getItem('disabledCategories') || '[]');
                        var idx = arr.indexOf(catName);
                        if (isDisabled && idx === -1) arr.push(catName);
                        else if (!isDisabled && idx !== -1) arr.splice(idx, 1);
                        localStorage.setItem('disabledCategories', JSON.stringify(arr));
                    } catch (e) {}
                };
            })(category, grid, document.createElement('button'), catName);

            // Delete button for local categories
            var delBtn = document.createElement('button');
            delBtn.className = 'cat-delete';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete this imported category';
            title.insertBefore(delBtn, title.querySelector('.cat-toggle'));
            delBtn.onclick = function (e) {
                e.stopPropagation();
                if (!confirm('Delete "' + category.querySelector('.category-title-text').textContent + '" and all its sounds?')) return;
                var catName = category.querySelector('.category-title-text').textContent;
                category.remove();
                // Remove from IndexedDB
                openImportDB().then(function (db) {
                    var tx = db.transaction('files', 'readwrite');
                    var idx = tx.objectStore('files').index('category');
                    var req = idx.openCursor(IDBKeyRange.only(catName));
                    req.onsuccess = function () {
                        var cursor = req.result;
                        if (cursor) {
                            cursor.delete();
                            cursor.continue();
                        }
                    };
                }).catch(function () {});
                // Clean up disabled state
                try {
                    var arr = JSON.parse(localStorage.getItem('disabledCategories') || '[]');
                    var idx2 = arr.indexOf(catName);
                    if (idx2 !== -1) { arr.splice(idx2, 1); localStorage.setItem('disabledCategories', JSON.stringify(arr)); }
                } catch (e) {}
                updateTotalCount();
            };

            DOM.soundboard.insertBefore(category, DOM.soundboard.firstChild);
        }

        for (var fi = 0; fi < files.length; fi++) {
            var file = files[fi];
            var blobUrl = URL.createObjectURL(file);
            var cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

            var btn = document.createElement('button');
            btn.className = 'sound-btn';
            btn.textContent = cleanName;
            btn.dataset.search = cleanName;
            btn.dataset.path = blobUrl;
            btn.dataset.local = '1';
            allSounds.push(blobUrl);
            var len = cleanName.length;
            if (len <= 5) btn.style.fontSize = '1.3rem';
            else if (len <= 9) btn.style.fontSize = '1.0rem';
            else if (len <= 14) btn.style.fontSize = '0.85rem';
            else if (len <= 22) btn.style.fontSize = '0.7rem';
            else btn.style.fontSize = '0.6rem';

            var stopBtn = document.createElement('button');
            stopBtn.className = 'stop-single-btn';
            stopBtn.textContent = '✕';
            stopBtn.title = 'Stop this sound';

            var loopBtn = document.createElement('button');
            loopBtn.className = 'loop-btn';
            loopBtn.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor"><path d="M15.5 2.5A1 1 0 0 1 16 4v3a1 1 0 0 1-1 1h-3a1 1 0 0 1 0-2h1.2A5.5 5.5 0 0 0 4.9 6.6a1 1 0 1 1-1.8-.8A7.5 7.5 0 0 1 15.5 4V3.5a1 1 0 0 1 1-1zM3.5 17A1 1 0 0 1 3 15.5v-3A1 1 0 0 1 4 11.5h3a1 1 0 0 1 0 2H5.8A5.5 5.5 0 0 0 15.1 13a1 1 0 0 1 1.8.8A7.5 7.5 0 0 1 4.5 16v.5a1 1 0 0 1-1 1z"/></svg>';
            loopBtn.title = 'Toggle loop';
            loopBtn.dataset.loop = 'false';

            var progressTrack = document.createElement('span');
            progressTrack.className = 'progress-track';
            var progressFill = document.createElement('span');
            progressFill.className = 'progress-fill';
            progressTrack.appendChild(progressFill);

            var skipBack = document.createElement('button');
            skipBack.className = 'skip-btn skip-back';
            skipBack.textContent = '-10';
            skipBack.title = 'Skip back 10s';

            var skipForward = document.createElement('button');
            skipForward.className = 'skip-btn skip-forward';
            skipForward.textContent = '+10';
            skipForward.title = 'Skip forward 10s';

            btn.appendChild(stopBtn);
            btn.appendChild(loopBtn);
            btn.appendChild(progressTrack);
            btn.appendChild(skipBack);
            btn.appendChild(skipForward);

            btn.addEventListener('click', function (e) {
                if (e.target.closest('.stop-single-btn')) {
                    stopSingle(this);
                    return;
                }
                if (e.target.closest('.loop-btn')) {
                    if (!paintLoopDrag) toggleLoop(this, this.querySelector('.loop-btn'));
                    paintLoopDrag = false;
                    paintPlayDrag = false;
                    return;
                }
                if (e.target.classList.contains('skip-back')) { skipSound(this, -10); return; }
                if (e.target.classList.contains('skip-forward')) { skipSound(this, 10); return; }
                if (paintPlayDrag) { paintPlayDrag = false; return; }
                playSound(this.dataset.path, this);
            });

            grid.appendChild(btn);
        }

        var count = grid.querySelectorAll('.sound-btn').length;
        var countSpan = category.querySelector('.folder-count');
        if (countSpan) countSpan.textContent = '[' + count + ' sounds]';
        else {
            countSpan = document.createElement('span');
            countSpan.className = 'folder-count';
            countSpan.textContent = '[' + count + ' sounds]';
            category.querySelector('.category-title').appendChild(countSpan);
        }
        updateTotalCount();
        if (!skipSave) saveImportsToDB(files, catName);
    }

    function playSound(path, triggerEl) {
        var speed = parseFloat(DOM.speedSlider.value);
        var cents = parseFloat(DOM.pitchSlider.value);

        triggerEl.classList.add('playing');

        // If Web Audio API is available and we can fetch, use proper pitch shift
        if (webAudioOk) {
            playWebAudio(path, triggerEl, speed, cents);
        } else {
            playFallback(path, triggerEl, speed, cents);
        }
    }

    // Web Audio API: speed changes speed+pitch, detune adjusts pitch
    function playWebAudio(path, triggerEl, speed, cents) {
        var ctx = getAudioCtx();

        if (!ctx) {
            webAudioOk = false;
            triggerEl.classList.remove('playing');
            playFallback(path, triggerEl, speed, cents);
            return;
        }

        function startSource(buffer) {
            if (ctx.state === 'closed') {
                webAudioOk = false;
                triggerEl.classList.remove('playing');
                playFallback(path, triggerEl, speed, cents);
                return;
            }

            var source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = speed;
            source.detune.value = cents;
            source.loop = triggerEl.dataset.loop === 'true';
            source.connect(eqFilters.length > 0 ? eqFilters[0] : (bassFilter || masterGain));

            var entry = { source: source, el: triggerEl, path: path, buffer: buffer, startTime: ctx.currentTime, duration: buffer.duration };
            activeAudios.push(entry);
            addTile(entry);
            startProgressLoop();

            source.onended = function () {
                removeAudio(entry);
            };

            try {
                source.start(0);
            } catch (e) {
                removeAudio(entry);
                webAudioOk = false;
                triggerEl.classList.remove('playing');
                playFallback(path, triggerEl, speed, cents);
            }
        }

        if (bufferCache[path]) {
            startSource(bufferCache[path]);
        } else {
            fetch(path)
                .then(function (r) { return r.arrayBuffer(); })
                .then(function (buf) { return ctx.decodeAudioData(buf); })
                .then(function (decoded) {
                    bufferCache[path] = decoded;
                    startSource(decoded);
                })
                .catch(function () {
                    // fetch/decode failed (likely file:// protocol) — disable Web Audio and fall back
                    webAudioOk = false;
                    triggerEl.classList.remove('playing');
                    playFallback(path, triggerEl, speed, cents);
                });
        }
    }

    // Fallback: combined playbackRate (changes both speed and pitch, but works everywhere)
    function playFallback(path, triggerEl, speed, cents) {
        var combinedRate = speed * Math.pow(2, cents / 1200);

        var audio = new Audio(path);
        audio.volume = parseFloat(DOM.volumeSlider.value);
        audio.playbackRate = combinedRate;
        audio.loop = triggerEl.dataset.loop === 'true';

        var entry = { audio: audio, el: triggerEl, path: path };
        activeAudios.push(entry);
        addTile(entry);
        startProgressLoop();

        triggerEl.classList.add('playing');

        audio.addEventListener('ended', function () {
            removeAudio(entry);
        });

        audio.play().catch(function (err) {
            removeAudio(entry);
            console.log('Playback error:', err);
        });
    }

    function removeAudio(entry) {
        var idx = activeAudios.indexOf(entry);
        if (idx !== -1) activeAudios.splice(idx, 1);
        removeTile(entry);

        var stillPlaying = false;
        for (var i = 0; i < activeAudios.length; i++) {
            if (activeAudios[i].el === entry.el) {
                stillPlaying = true;
                break;
            }
        }
        if (!stillPlaying) {
            entry.el.classList.remove('playing');
            var fill = entry.el.querySelector('.progress-fill');
            if (fill) fill.style.width = '0%';
        }
    }

    function updateActiveRates() {
        var speed = parseFloat(DOM.speedSlider.value);
        var cents = parseFloat(DOM.pitchSlider.value);
        var combinedRate = speed * Math.pow(2, cents / 1200);

        for (var i = 0; i < activeAudios.length; i++) {
            var entry = activeAudios[i];
            if (entry.source) {
                entry.source.playbackRate.value = speed;
                entry.source.detune.value = cents;
            } else if (entry.audio) {
                entry.audio.playbackRate = combinedRate;
            }
        }
    }

    function toggleLoop(btn, loopBtn) {
        var on = btn.dataset.loop !== 'true';
        btn.dataset.loop = on ? 'true' : 'false';
        loopBtn.classList.toggle('loop-active', on);

        for (var i = 0; i < activeAudios.length; i++) {
            var entry = activeAudios[i];
            if (entry.el === btn) {
                if (entry.source) entry.source.loop = on;
                if (entry.audio) entry.audio.loop = on;
            }
        }
    }

    function stopSingle(el) {
        for (var i = activeAudios.length - 1; i >= 0; i--) {
            var entry = activeAudios[i];
            if (entry.el === el) {
                if (entry.source) {
                    try { entry.source.stop(); } catch (e) {}
                    entry.source.onended = null;
                }
                if (entry.audio) {
                    try { entry.audio.pause(); entry.audio.currentTime = 0; } catch (e) {}
                }
                removeTile(entry);
                activeAudios.splice(i, 1);
            }
        }
        el.classList.remove('playing');
        var fill = el.querySelector('.progress-fill');
        if (fill) fill.style.width = '0%';
    }

    function stopAll() {
        for (var i = activeAudios.length - 1; i >= 0; i--) {
            var entry = activeAudios[i];
            if (entry.source) {
                try { entry.source.stop(); } catch (e) {}
            }
            if (entry.audio) {
                try { entry.audio.pause(); entry.audio.currentTime = 0; } catch (e) {}
            }
            entry.el.classList.remove('playing');
            var fill = entry.el.querySelector('.progress-fill');
            if (fill) fill.style.width = '0%';
        }
        activeAudios = [];
        DOM.nowPlaying.innerHTML = '';
        stopProgressLoop();
    }

    function addTile(entry) {
        if (entry.tileEl) return;
        var name = entry.path.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '');
        var tile = document.createElement('div');
        tile.className = 'playing-tile';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'tile-name';
        nameSpan.textContent = name;
        var stopBtn = document.createElement('button');
        stopBtn.className = 'tile-stop';
        stopBtn.textContent = '✕';
        stopBtn.title = 'Stop "' + name + '"';
        stopBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            stopOne(entry);
        });
        tile.appendChild(nameSpan);
        tile.appendChild(stopBtn);
        DOM.nowPlaying.appendChild(tile);
        entry.tileEl = tile;
    }

    function removeTile(entry) {
        if (entry.tileEl) {
            entry.tileEl.remove();
            entry.tileEl = null;
        }
    }

    function stopOne(entry) {
        if (entry.source) {
            try { entry.source.stop(); } catch (e) {}
            entry.source.onended = null;
        } else if (entry.audio) {
            try { entry.audio.pause(); entry.audio.currentTime = 0; } catch (e) {}
        }
        removeAudio(entry);
    }

    function filterSounds() {
        var query = DOM.searchInput.value.toLowerCase().trim();
        var categories = document.querySelectorAll('.category-container');
        var matched = [];
        var unmatched = [];

        for (var ci = 0; ci < categories.length; ci++) {
            var cat = categories[ci];
            var title = cat.querySelector('.category-title');
            var grid = cat.querySelector('.buttons-grid');
            var buttons = grid.querySelectorAll('.sound-btn');
            var hasVisible = false;

            if (cat.classList.contains('cat-disabled')) {
                for (var bi2 = 0; bi2 < buttons.length; bi2++) {
                    buttons[bi2].classList.add('hidden');
                }
                if (query !== '') unmatched.push(cat);
                else matched.push(cat);
                continue;
            }

            if (query !== '') {
                title.classList.remove('collapsed');
                grid.classList.remove('collapsed');
            }

            for (var bi = 0; bi < buttons.length; bi++) {
                var btn = buttons[bi];
                var text = (btn.dataset.search || btn.textContent).toLowerCase();
                var match = query === '' || text.indexOf(query) !== -1;

                if (match) {
                    btn.classList.remove('hidden');
                    hasVisible = true;
                } else {
                    btn.classList.add('hidden');
                }
            }

            var existingNoResults = cat.querySelector('.no-results');
            if (!hasVisible && query !== '') {
                if (!existingNoResults) {
                    var msg = document.createElement('div');
                    msg.className = 'no-results';
                    msg.textContent = '╳ NO MATCHES';
                    grid.parentNode.insertBefore(msg, grid.nextSibling);
                }
            } else {
                if (existingNoResults) {
                    existingNoResults.remove();
                }
            }

            if (hasVisible) matched.push(cat);
            else unmatched.push(cat);
        }

        if (query !== '') {
            matched.concat(unmatched).forEach(function (c) {
                DOM.soundboard.appendChild(c);
            });
        }
    }

    var progressRAF = null;

    function startProgressLoop() {
        if (progressRAF) return;
        function tick() {
            updateProgressBars();
            progressRAF = requestAnimationFrame(tick);
        }
        progressRAF = requestAnimationFrame(tick);
    }

    function stopProgressLoop() {
        if (progressRAF) {
            cancelAnimationFrame(progressRAF);
            progressRAF = null;
        }
    }

    function updateProgressBars() {
        var hasActive = false;
        for (var i = 0; i < activeAudios.length; i++) {
            var entry = activeAudios[i];
            var fill = entry.el.querySelector('.progress-fill');
            if (!fill) continue;
            var pct = 0;
            if (entry.audio) {
                if (entry.audio.duration && isFinite(entry.audio.duration)) {
                    pct = (entry.audio.currentTime / entry.audio.duration) * 100;
                }
            } else if (entry.source && entry.startTime) {
                var ctx = getAudioCtx();
                if (ctx && entry.duration) {
                    pct = ((ctx.currentTime - entry.startTime) / entry.duration) * 100;
                    if (pct > 100) pct = 100;
                }
            }
            fill.style.width = pct + '%';
            hasActive = true;
        }
        if (!hasActive) stopProgressLoop();
    }

    function skipSound(btn, delta) {
        for (var i = 0; i < activeAudios.length; i++) {
            var entry = activeAudios[i];
            if (entry.el !== btn) continue;

            var dur = entry.duration || (entry.audio ? entry.audio.duration : 0);
            if (!dur || !isFinite(dur)) continue;

            var cur = entry.audio ? entry.audio.currentTime : (entry.startTime ? (getAudioCtx().currentTime - entry.startTime) : 0);
            var offset = Math.max(0, Math.min(dur, cur + delta));

            if (entry.audio) {
                try { entry.audio.currentTime = offset; } catch (e) {}
            } else if (entry.source && entry.buffer) {
                var ctx = getAudioCtx();
                if (!ctx) continue;
                entry.source.onended = null;
                try { entry.source.stop(); } catch (e) {}
                var speed = parseFloat(DOM.speedSlider.value);
                var cents = parseFloat(DOM.pitchSlider.value);
                var src = ctx.createBufferSource();
                src.buffer = entry.buffer;
                src.playbackRate.value = speed;
                src.detune.value = cents;
                src.loop = entry.el.dataset.loop === 'true';
                src.connect(eqFilters.length > 0 ? eqFilters[0] : (bassFilter || masterGain));
                src.start(0, offset);
                src.onended = function () { removeAudio(entry); };
                entry.source = src;
                entry.startTime = ctx.currentTime - offset;
            }
        }
    }

    function formatFreq(freq) {
        return freq >= 1000 ? (freq / 1000) + 'k' : freq + 'Hz';
    }

    function invPosX(px) {
        var w = DOM.eqCanvas.width / (window.devicePixelRatio || 1);
        var ratio = px / w;
        return Math.round(minFreq * Math.pow(maxFreq / minFreq, ratio));
    }
    function invPosY(py) {
        var h = DOM.eqCanvas.height / (window.devicePixelRatio || 1);
        return Math.max(-50, Math.min(50, Math.round(-50 + (1 - py / h) * 100)));
    }

    function rebuildEqChain() {
        if (!audioCtx) return;
        eqBands.forEach(function (b) {
            if (b.filter) try { b.filter.disconnect(); } catch (e) {}
        });
        eqBands.sort(function (a, b) { return a.freq - b.freq; });
        eqFilters = [];
        eqBands.forEach(function (band, idx) {
            if (!band.filter) {
                band.filter = audioCtx.createBiquadFilter();
                band.filter.type = 'peaking';
            }
            band.filter.frequency.value = band.freq;
            band.filter.gain.value = band.gain;
            band.filter.Q.value = band.q;
            eqFilters.push(band.filter);
        });
        for (var ri = 0; ri < eqFilters.length; ri++) {
            if (ri < eqFilters.length - 1) {
                eqFilters[ri].connect(eqFilters[ri + 1]);
            } else {
                eqFilters[ri].connect(bassFilter);
            }
        }
        // Reconnect any actively-playing sources to the new chain
        var dst = eqFilters.length > 0 ? eqFilters[0] : bassFilter;
        for (var asi = 0; asi < activeAudios.length; asi++) {
            var aSrc = activeAudios[asi].source;
            if (aSrc) {
                try { aSrc.disconnect(); } catch (e) {}
                aSrc.connect(dst);
            }
        }
    }

    function addEqBand(freq, gain) {
        var idx = eqBands.length;
        eqBands.push({ freq: freq, gain: gain, q: 0.1, filter: null });
        rebuildEqChain();
        for (var ai = 0; ai < eqBands.length; ai++) {
            if (eqBands[ai].freq === freq && eqBands[ai].gain === gain) {
                idx = ai; break;
            }
        }
        return idx;
    }

    function removeEqBand(index) {
        if (index < 0 || index >= eqBands.length) return;
        if (eqBands.length <= 1) return; // keep at least one dot
        eqBands.splice(index, 1);
        if (selectedBand === index) {
            selectedBand = -1;
            if (DOM.eqQRow) DOM.eqQRow.style.display = 'none';
        } else if (selectedBand > index) {
            selectedBand--;
        }
        rebuildEqChain();
    }

    function buildEqPanel() {
        getAudioCtx();
        eqCanvasCtx = DOM.eqCanvas.getContext('2d');
        resizeEqCanvas();

        function getBandAtPos(x, y) {
            var closest = -1;
            var minDist = 40;
            for (var bi = 0; bi < eqBands.length; bi++) {
                var bx = posX(eqBands[bi].freq);
                var by = posY(eqBands[bi].gain);
                var dx = x - bx;
                var dy = y - by;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
                    closest = bi;
                }
            }
            return closest;
        }

        var clickStartX = 0, clickStartY = 0, clickMoved = false;

        function selectBand(index) {
            selectedBand = index;
            if (index >= 0 && index < eqBands.length) {
                DOM.eqQRow.style.display = 'flex';
                var q = eqBands[index].q;
                DOM.eqQSlider.value = Math.max(1, Math.min(100, Math.round(q * 10)));
                DOM.eqQVal.textContent = q.toFixed(1);
            } else {
                DOM.eqQRow.style.display = 'none';
            }
        }

        DOM.eqCanvas.addEventListener('pointerdown', function (e) {
            var rect = DOM.eqCanvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var band = getBandAtPos(x, y);
            if (band >= 0) {
                dragBand = band;
                selectBand(band);
                dragStartY = y;
                dragStartX = x;
                dragStartGain = eqBands[band].gain;
                dragStartFreq = eqBands[band].freq;
                DOM.eqCanvas.setPointerCapture(e.pointerId);
                e.preventDefault();
            } else {
                clickStartX = x;
                clickStartY = y;
                clickMoved = false;
            }
        });

        DOM.eqCanvas.addEventListener('pointermove', function (e) {
            var rect = DOM.eqCanvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            if (dragBand >= 0) {
                var dy = dragStartY - y;
                var dx = x - dragStartX;
                var newGain = Math.max(-50, Math.min(50, Math.round(dragStartGain + dy * 0.8)));
                var newFreq = invPosX(posX(dragStartFreq) + dx);
                if (newFreq < 20) newFreq = 20;
                if (newFreq > 20000) newFreq = 20000;
                eqBands[dragBand].gain = newGain;
                eqBands[dragBand].freq = newFreq;
                eqBands[dragBand].filter.frequency.value = newFreq;
                if (!wobbleOn && !chaosOn) {
                    eqBands[dragBand].filter.gain.value = newGain;
                }
                var gainTxt = (newGain > 0 ? '+' : '') + newGain + 'dB';
                DOM.eqTooltip.innerHTML = '<span class="gain-val' + (newGain > 0 ? ' pos' : (newGain < 0 ? ' neg' : '')) + '">' + gainTxt + '</span>';
                DOM.eqTooltip.style.display = 'block';
                var tx = e.clientX - rect.left + 12;
                var ty = e.clientY - rect.top - 10;
                DOM.eqTooltip.style.left = tx + 'px';
                DOM.eqTooltip.style.top = ty + 'px';
                e.preventDefault();
            } else {
                if (Math.abs(x - clickStartX) > 5 || Math.abs(y - clickStartY) > 5) {
                    clickMoved = true;
                }
                // Hover tooltip over bands
                var hoverBand = getBandAtPos(x, y);
                if (hoverBand >= 0) {
                    var b = eqBands[hoverBand];
                    var hGain = b.filter ? b.filter.gain.value : b.gain;
                    var hQ = b.filter ? b.filter.Q.value : b.q;
                    var hGainTxt = (hGain > 0 ? '+' : '') + hGain + 'dB';
                    DOM.eqTooltip.innerHTML = '<span class="gain-val' + (hGain > 0 ? ' pos' : (hGain < 0 ? ' neg' : '')) + '">' + hGainTxt + '</span><span class="q-val">Q ' + hQ.toFixed(1) + '</span>';
                    DOM.eqTooltip.style.display = 'block';
                    DOM.eqTooltip.style.left = (x + 12) + 'px';
                    DOM.eqTooltip.style.top = (y - 10) + 'px';
                } else {
                    DOM.eqTooltip.style.display = 'none';
                }
            }
        });

        DOM.eqCanvas.addEventListener('pointerup', function () {
            if (dragBand >= 0) {
                dragBand = -1;
                DOM.eqTooltip.style.display = 'none';
            } else if (!clickMoved) {
                var rect = DOM.eqCanvas.getBoundingClientRect();
                var x = clickStartX;
                var y = clickStartY;
                var freq = invPosX(x);
                var gain = invPosY(y);
                var nidx = addEqBand(freq, gain);
                selectBand(nidx);
            }
        });

        DOM.eqCanvas.addEventListener('pointerleave', function () {
            if (dragBand >= 0) {
                dragBand = -1;
                DOM.eqTooltip.style.display = 'none';
            }
        });

        DOM.eqCanvas.addEventListener('dblclick', function (e) {
            var rect = DOM.eqCanvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var band = getBandAtPos(x, y);
            if (band >= 0) {
                removeEqBand(band);
                e.preventDefault();
            }
        });

        DOM.eqCanvas.addEventListener('wheel', function (e) {
            var rect = DOM.eqCanvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var band = getBandAtPos(x, y);
            if (band >= 0) {
                e.preventDefault();
                var b = eqBands[band];
                b.q = Math.max(0.1, Math.min(10, Math.round((b.q - e.deltaY * 0.005) * 10) / 10));
                if (b.filter) b.filter.Q.value = b.q;
                DOM.eqTooltip.innerHTML = '<span>Q ' + b.q.toFixed(1) + '</span>';
                DOM.eqTooltip.style.display = 'block';
                DOM.eqTooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                DOM.eqTooltip.style.top = (e.clientY - rect.top - 10) + 'px';
                clearTimeout(DOM.eqTooltip._hide);
                DOM.eqTooltip._hide = setTimeout(function () { DOM.eqTooltip.style.display = 'none'; }, 1500);
            }
        }, { passive: false });

        // Wire up fun mode toolbar buttons
        DOM.eqWobble = document.getElementById('eq-wobble');
        DOM.eqScatter = document.getElementById('eq-scatter');
        DOM.eqChaos = document.getElementById('eq-chaos');
        DOM.wobbleSpeed = document.getElementById('wobble-speed');
        DOM.wobbleRow = document.getElementById('wobble-row');
        DOM.eqExtras = document.getElementById('eq-extras');

        if (DOM.eqQSlider) {
            DOM.eqQSlider.addEventListener('input', function () {
                updateSliderModified(this);
                if (selectedBand < 0 || selectedBand >= eqBands.length) return;
                var q = parseFloat(this.value) / 10;
                eqBands[selectedBand].q = q;
                if (eqBands[selectedBand].filter) {
                    eqBands[selectedBand].filter.Q.value = q;
                }
                DOM.eqQVal.textContent = q.toFixed(1);
            });
        }

        if (DOM.eqWobble) {
            DOM.eqWobble.addEventListener('click', function () {
                wobbleOn = !wobbleOn;
                this.classList.toggle('active', wobbleOn);
                if (DOM.wobbleRow) DOM.wobbleRow.style.display = wobbleOn ? 'flex' : 'none';
                if (DOM.eqExtras) DOM.eqExtras.style.display = wobbleOn ? 'block' : 'none';
            });
        }
        if (DOM.wobbleSpeed) {
            DOM.wobbleSpeed.addEventListener('input', function () {
                updateSliderModified(this);
                wobbleSpeed = parseFloat(this.value);
                var v = document.getElementById('wobble-speed-val');
                if (v) v.textContent = this.value;
            });
        }
        if (DOM.eqScatter) {
            DOM.eqScatter.addEventListener('click', function () {
                if (eqBands.length === 0) return;
                eqBands.forEach(function (band) {
                    band.gain = Math.round((Math.random() * 60 - 30));
                    band.q = Math.round((0.2 + Math.random() * 4.8) * 10) / 10;
                    if (!wobbleOn && !chaosOn) {
                        band.filter.gain.value = band.gain;
                        band.filter.Q.value = band.q;
                    }
                });
            });
        }
        if (DOM.eqChaos) {
            DOM.eqChaos.addEventListener('click', function () {
                chaosOn = !chaosOn;
                this.classList.toggle('active', chaosOn);
            });
        }

        // Start with one default dot at 1kHz, 0dB
        if (eqBands.length === 0) {
            addEqBand(1000, 0);
        }

        startEqAnimation();
    }

    function resizeEqCanvas() {
        if (!eqCanvasCtx) return;
        var rect = DOM.eqCanvas.parentNode.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        DOM.eqCanvas.width = rect.width * dpr;
        DOM.eqCanvas.height = rect.height * dpr;
        DOM.eqCanvas.style.width = rect.width + 'px';
        DOM.eqCanvas.style.height = rect.height + 'px';
        eqCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function applyEqModulations() {
        if (eqBands.length === 0) return;
        var t = Date.now() / 1000;

        for (var mi = 0; mi < eqBands.length; mi++) {
            var band = eqBands[mi];
            var g = band.gain;
            var q = band.q;

            if (wobbleOn) {
                var rate = wobbleSpeed * 0.5;
                g += Math.sin(t * rate * Math.PI * 2 + mi * 1.2) * 15;
            }
            if (chaosOn) {
                if (!band.chaosPhase) band.chaosPhase = 0;
                band.chaosPhase += (Math.random() - 0.5) * 0.4;
                if (band.chaosPhase > 1) band.chaosPhase = 1;
                if (band.chaosPhase < -1) band.chaosPhase = -1;
                g += band.chaosPhase * 15;
                q = Math.max(0.2, Math.min(3.0, q + (Math.random() - 0.5) * 0.05));
            }

            g = Math.max(-50, Math.min(50, Math.round(g)));
            if (band.filter) {
                band.filter.gain.value = g;
                band.filter.Q.value = q;
            }
        }
    }

    function drawEqVisualization() {
        if (!eqCanvasCtx) return;
        var w = DOM.eqCanvas.width / (window.devicePixelRatio || 1);
        var h = DOM.eqCanvas.height / (window.devicePixelRatio || 1);
        if (w === 0 || h === 0) return;

        var ctx = eqCanvasCtx;
        ctx.clearRect(0, 0, w, h);

        // Grid — horizontal (dB reference lines at -100, -80, -60, -40, -20, 0)
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.06)';
        ctx.lineWidth = 1;
        for (var gdb = -100; gdb <= 0; gdb += 20) {
            var gy = (gdb + 100) / 100 * h;
            if (gy < 0 || gy > h) continue;
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(w, gy);
            ctx.stroke();
        }
        // Grid — vertical (frequency band markers at each active band)
        for (var gvi = 0; gvi < eqBands.length; gvi++) {
            var gx = posX(eqBands[gvi].freq);
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, h);
            ctx.stroke();
        }

        // Spectrum analyzer (FFT frequency data)
        if (analyser && freqDataArray) {
            analyser.getFloatFrequencyData(freqDataArray);
            var binCount = freqDataArray.length;
            var sampleRate = audioCtx.sampleRate || 48000;
            var binWidth = sampleRate / analyser.fftSize;
            var specPoints = 300;
            var specData = [];
            for (var spi = 0; spi <= specPoints; spi++) {
                var f = minFreq * Math.pow(maxFreq / minFreq, spi / specPoints);
                var bin = Math.round(f / binWidth);
                if (bin >= binCount) bin = binCount - 1;
                if (bin < 0) bin = 0;
                var dB = freqDataArray[bin];
                var norm = (dB + 100) / 100;
                if (norm < 0) norm = 0;
                if (norm > 1) norm = 1;
                var sx = posX(f);
                var sy = h * (1 - norm);
                specData.push({ x: sx, y: sy, db: dB });
            }

            ctx.beginPath();
            ctx.moveTo(specData[0].x, h);
            for (var si = 0; si < specData.length; si++) {
                ctx.lineTo(specData[si].x, specData[si].y);
            }
            ctx.lineTo(specData[specData.length - 1].x, h);
            ctx.closePath();
            var specGrad = ctx.createLinearGradient(0, 0, 0, h);
            specGrad.addColorStop(0, 'rgba(0, 255, 0, 0.18)');
            specGrad.addColorStop(0.4, 'rgba(0, 255, 0, 0.06)');
            specGrad.addColorStop(1, 'rgba(0, 255, 0, 0.01)');
            ctx.fillStyle = specGrad;
            ctx.fill();

            ctx.shadowColor = 'rgba(0, 255, 0, 0.4)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(specData[0].x, specData[0].y);
            for (var sj = 1; sj < specData.length; sj++) {
                ctx.lineTo(specData[sj].x, specData[sj].y);
            }
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // EQ frequency response curve (uses actual per-band Q from filters)
        var smpl = 200;
        var pts = [];
        for (var si = 0; si <= smpl; si++) {
            var freq = minFreq * Math.pow(maxFreq / minFreq, si / smpl);
            var totalDb = 0;
            for (var fi = 0; fi < eqBands.length; fi++) {
                var band = eqBands[fi];
                var gain = band.filter ? band.filter.gain.value : band.gain;
                if (gain === 0) continue;
                var bandQ = band.filter ? band.filter.Q.value : band.q;
                var w0 = freq / band.freq;
                var wReal = 1 - w0 * w0;
                var A = Math.pow(10, gain / 40);
                var numImag = w0 * A / bandQ;
                var denImag = w0 / (A * bandQ);
                var mag2 = (wReal * wReal + numImag * numImag) / (wReal * wReal + denImag * denImag);
                totalDb += 10 * Math.log10(mag2);
            }
            var x = posX(freq);
            var y = posY(totalDb);
            pts.push({ x: x, y: y });
        }

        ctx.shadowColor = '#00ff00';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var pj = 1; pj < pts.length; pj++) {
            ctx.lineTo(pts[pj].x, pts[pj].y);
        }
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Dots at each band
        for (var di = 0; di < eqBands.length; di++) {
            var band = eqBands[di];
            var dx = posX(band.freq);
            var gainHere = band.filter ? band.filter.gain.value : band.gain;
            var dy = posY(gainHere);
            var isSelected = di === selectedBand;
            ctx.beginPath();
            ctx.arc(dx, dy, isSelected ? 13 : 10, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? 'rgba(255, 255, 0, 0.2)' : 'rgba(0, 255, 0, 0.15)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(dx, dy, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
            ctx.strokeStyle = isSelected ? '#ffff00' : '#00ff00';
            ctx.lineWidth = isSelected ? 3 : 2.5;
            ctx.stroke();
        }

        // Center reference line
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Frequency labels at bottom with background boxes
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var fl = 0; fl < eqBands.length; fl++) {
            var lx = posX(eqBands[fl].freq);
            var lyt = h - 12;
            var lyb = h - 3;
            if (fl % 2 === 0) { lyt = h - 24; lyb = h - 15; }
            ctx.font = 'bold 11px monospace';
            var txt = formatFreq(eqBands[fl].freq);
            var tw = ctx.measureText(txt).width + 6;
            var tx = lx - tw / 2;
            var ty = lyt;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(tx, ty, tw, lyb - lyt);
            ctx.fillStyle = 'rgba(0, 255, 0, 0.9)';
            ctx.fillText(txt, lx, (lyt + lyb) / 2);
        }
    }

    function startEqAnimation() {
        if (eqAnimating) return;
        eqAnimating = true;
        (function tick() {
            if (!eqAnimating) return;
            applyEqModulations();
            drawEqVisualization();
            requestAnimationFrame(tick);
        })();
    }

    function stopEqAnimation() {
        eqAnimating = false;
    }

    function startAutoPitch() {
        var currentTarget = 0;
        var currentVal = 0;
        var startVal = 0;
        var progress = 1;

        function nextTarget() {
            switch (autoPitchModes[autoPitchMode]) {
                case 'STEP':
                    return currentVal > 0 ? -1200 : 1200;
                case 'DRIFT':
                    return currentVal + (Math.floor(Math.random() * 401) - 200);
                default: // RND
                    return Math.floor(Math.random() * 2401) - 1200;
            }
        }

        function tick() {
            if (!autoPitchOn) return;
            if (progress >= 1) {
                startVal = currentVal;
                currentTarget = Math.max(-1200, Math.min(1200, nextTarget()));
                progress = 0;
            }
            progress += autoPitchSpeed / 600;
            if (progress > 1) progress = 1;
            var t = progress * progress * (3 - 2 * progress);
            currentVal = startVal + (currentTarget - startVal) * t;
            DOM.pitchSlider.value = Math.round(currentVal);
            DOM.pitchValue.textContent = Math.round(currentVal) + '¢';
            updateActiveRates();
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function stopAutoPitch() {
        autoPitchOn = false;
        DOM.pitchSlider.value = '0';
        DOM.pitchValue.textContent = '0¢';
        if (DOM.pitchSpeedWrap) DOM.pitchSpeedWrap.style.display = 'none';
        updateActiveRates();
    }

    document.addEventListener('DOMContentLoaded', function () {
        start();
        // Restore imported files from IndexedDB after soundboard is built
        setTimeout(restoreImports, 100);
    });
})();
