import Phaser from 'phaser';
import 'phaser/plugins/spine4.1/dist/SpinePlugin';

const config = {
    type: Phaser.AUTO,
    width: 360,
    height: 640,
    backgroundColor: '#ffffff',
    parent: document.body,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    plugins: {
        scene: [
            { key: 'SpinePlugin', plugin: window.SpinePlugin, mapping: 'spine' }
        ]
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let runner; 
let floor;
let background;
let foreground; // New foreground sprite
let speedText;
let timerText;
let distanceText;
let highBpmText;
let levelText;
let bpmText;
let speedBar;
let distanceBar;
let beatBar; 
let instructionsText;
let upgradeOption1Text;
let upgradeOption2Text;
let comboText;
let distanceMarkers = [];
let audioContext;
let nextNoteTime = 0.0;
let beatCount = 0;
let isAudioStarted = false;
let activeBeats = []; // Track active beats for miss detection

// Game State
let level = 1;
let currentSpeed = 0;
let distance = 0;
let combo = 0;
let highestBpm = 80; // Track highest BPM reached 

let startTime = 0;
let finishTime = 0;
let isRunning = false;
let isFinished = false;
let isCountingDown = false;
let countdownNumber = 3;
let countdownText = null;
let showDotsInCountdown = false; // Show dots during final "1" phase

// Rhythm Constants
let currentTempo = 80; // Starting BPM
const START_BPM = 80;
// No TARGET_BPM or RAMP_DURATION needed for infinite scaling

// We now calculate seconds per beat dynamically
const LOOKAHEAD = 25.0; 
const SCHEDULE_AHEAD_TIME = 0.1; 

// Visual Beat Constants
const BEAT_BAR_Y = 320; // Center of screen (640 / 2)
const BEAT_SPEED = 300; 

// Constants
let maxSpeedLimit = 500; 
let goalDistance = 100; // dynamic goal distance
const SPEED_DECAY = 2; 
const SPEED_GAIN_PER_HIT = 100; 
const PIXELS_PER_METER = 20; 

function preload() {
    this.load.spine('spineboy', 'assets/spine/spineboy.json', 'assets/spine/spineboy.atlas');
    this.load.image('background', 'assets/background.png');
    this.load.image('foreground', 'assets/foreground.png');
}

function create() {
    const width = this.sys.game.config.width;
    const height = this.sys.game.config.height;

    // Background Layer (TileSprite for scrolling)
    // Use 'background' image. Scale to fit height of screen.
    background = this.add.tileSprite(width / 2, height / 2, width, height, 'background');
    
    // Scale background to fit height to prevent vertical tiling
    const bgTexture = this.textures.get('background');
    const bgImage = bgTexture.getSourceImage();
    const bgScale = height / bgImage.height;
    background.setTileScale(bgScale, bgScale);
    
    background.setScrollFactor(0); 
    background.setDepth(0);

    // Foreground Layer (Road/Ground)
    // Use 'foreground' image.
    foreground = this.add.tileSprite(width / 2, height / 2, width, height, 'foreground'); 
    
    // Scale foreground to fit height
    const fgTexture = this.textures.get('foreground');
    const fgImage = fgTexture.getSourceImage();
    const fgScale = height / fgImage.height;
    foreground.setTileScale(fgScale, fgScale);
    
    foreground.setDepth(1);

    // Runner - Layer 2
    
    // UI elements need higher depth
    // We can set depth for bars and text later or now.
    // BeatBar is created later. Let's set its depth then.

    // Floor (Horizontal Line) - Removed or invisible now? 
    // Let's keep it for visual reference or hide it if images cover it.
    floor = this.add.graphics();
    // floor.setVisible(false); // Maybe hide it if we have images
    
    // Distance Markers (Text)
    for (let m = 0; m <= 200; m += 10) {
        let text = this.add.text(0, height * 0.75 + 20, m + 'm', { font: '900 16px sans-serif', fill: '#555555' }).setOrigin(0.5, 0);
        text.setVisible(false);
        distanceMarkers.push({ meter: m, text: text });
    }

    // Runner
    const runnerX = width * 0.3;
    const runnerY = height * 0.75;
    
    runner = this.add.spine(runnerX, runnerY, 'spineboy', 'idle', true);
    runner.setScale(0.3);
    runner.setDepth(2); // Ensure runner is on top of foreground (Depth 1)
    
    // UI (levelText hidden for endless mode)
    levelText = this.add.text(10, 10, 'LEVEL: 1', { font: '900 24px sans-serif', fill: '#000000' });
    levelText.setVisible(false);
    
    // BPM Text moved up 20% (runnerY is 0.75 * 640 = 480).
    // Original y was 276. Up 20% of screen height (128) -> 276 - 64 (extra 10%) = 212?
    // User said "move bpm text up 20%". Relative to current or original?
    // Let's assume relative to screen height. 276 was already up 10% from 340.
    // Let's try y = 200.
    // 50% larger font -> 48px * 1.5 = 72px
    bpmText = this.add.text(width * 0.5, 200, '80 BPM', { font: '900 72px sans-serif', fill: '#ff6347' }).setOrigin(0.5); 
    
    // Combo Text
    comboText = this.add.text(width * 0.5, 260, 'COMBO: 0x', { font: '900 32px sans-serif', fill: '#ffff00' }).setOrigin(0.5);
    comboText.setVisible(false);

    // Bars (speed UI hidden for endless mode)
    speedBar = this.add.graphics();
    speedBar.setVisible(false);
    speedText = this.add.text(20, 57, 'SPEED: 0', { font: '900 16px sans-serif', fill: '#ffffff' });
    speedText.setVisible(false);
    
    distanceBar = this.add.graphics();
    distanceBar.setVisible(false);
    distanceText = this.add.text(10, 10, 'DISTANCE: 0M', { font: '900 24px sans-serif', fill: '#000000' });
    highBpmText = this.add.text(10, 40, 'BEST BPM: 80', { font: '900 20px sans-serif', fill: '#ff6347' }); 
    
    beatBar = this.add.graphics();
    beatBar.setDepth(3); // Beat bar on top of foreground
    
    // Beat Line Background (Solid color behind beat lines so they are visible)
    // Drawn by beatBar graphics in update, but we need to ensure it covers the area.
    // Or we can add a separate graphics object for the beat bg if we want it behind lines but in front of foreground?
    // Actually, if Foreground covers the area, and BeatBar is on top, the lines will be visible on top of Foreground.
    // That matches "covers the background of the beat line area".
    
    // UI Depths
    // Ensure beatBar is high enough
    if (beatBar) beatBar.setDepth(20); 
    
    if (levelText) levelText.setDepth(30);
    if (bpmText) bpmText.setDepth(30);
    if (comboText) comboText.setDepth(30);
    if (speedBar) speedBar.setDepth(30);
    if (speedText) speedText.setDepth(30);
    if (distanceBar) distanceBar.setDepth(30);
    if (distanceText) distanceText.setDepth(30);
    if (timerText) timerText.setDepth(30);
    if (instructionsText) instructionsText.setDepth(30);
    if (upgradeOption1Text) upgradeOption1Text.setDepth(30);
    if (upgradeOption2Text) upgradeOption2Text.setDepth(30);
    
    updateBars();

    timerText = this.add.text(width - 10, 10, 'TIME: 0.00S', { font: '900 24px sans-serif', fill: '#000000' }).setOrigin(1, 0);
    timerText.setVisible(false);
    
    if (highBpmText) highBpmText.setDepth(30);

    instructionsText = this.add.text(width / 2, height / 2, 'TAP TO START!\nHIT THE BEATS\nRUN FOREVER', { font: '900 24px sans-serif', fill: '#000000', align: 'center' }).setOrigin(0.5);
    instructionsText.setDepth(30);
    
    // Upgrade UI (hidden for endless mode)
    upgradeOption1Text = this.add.text(width / 2, height / 2 + 50, '', { font: '900 20px sans-serif', fill: '#008800' }).setOrigin(0.5).setVisible(false);
    upgradeOption1Text.setDepth(30);

    upgradeOption2Text = this.add.text(width / 2, height / 2 + 100, '', { font: '900 20px sans-serif', fill: '#000088' }).setOrigin(0.5).setVisible(false);
    upgradeOption2Text.setDepth(30);

    // Input
    // We bind pointerdown to handleInput, but we also need to ensure the audio context is resumed.
    // handleInput does call initAudio(), but sometimes browser policies block audio if not directly in the handler.
    // Also, if "click doesnt start game", maybe handleInput has logic preventing it.
    // handleInput checks !isAudioStarted.
    this.input.on('pointerdown', () => {
        handleInput();
    });
    
    // Mobile Touch Controls - Direct DOM touch events for better responsiveness
    const canvas = this.sys.game.canvas;
    
    // Prevent default touch behaviors (scrolling, zooming)
    canvas.style.touchAction = 'none';
    
    // Unified touch start handler
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleInput();
    }, { passive: false });
    
    // Prevent default on touch end
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    // Prevent context menu on long press
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
}

// Audio Engine
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        nextNoteTime = audioContext.currentTime + 0.1;
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
             console.log("Audio Context Resumed");
        });
    }
    isAudioStarted = true;
}

// Simple Bass and Melody Logic
// Key: E Minor (E, G, A, B, D)
// Frequencies: E2=82.41, G2=98.00, A2=110.00, B2=123.47, D3=146.83
const BASS_FREQS = [82.41, 82.41, 98.00, 82.41, 110.00, 98.00, 123.47, 82.41]; // 8 step loop
// Melody higher octave: E4=329.63 etc
const MELODY_FREQS = [329.63, 0, 392.00, 0, 440.00, 392.00, 587.33, 493.88]; // 0 = rest

// High energy melody for > 120 BPM - 3 octave arpeggiator (up then down)
// E minor pentatonic across 3 octaves: E4-G4-A4-B4-D5 | E5-G5-A5-B5-D6 | E6-G6-A6-B6-D7
// 16 step loop (double the bass 8-step = 16 notes per bass cycle)
const HIGH_ARPEGGIO_FREQS = [
    // Going UP (8 steps)
    329.63,  // E4
    392.00,  // G4
    440.00,  // A4
    493.88,  // B4
    587.33,  // D5
    659.25,  // E5
    783.99,  // G5
    880.00,  // A5
    // Going DOWN (8 steps)
    987.77,  // B5
    880.00,  // A5
    783.99,  // G5
    659.25,  // E5
    587.33,  // D5
    493.88,  // B4
    440.00,  // A4
    392.00   // G4
];
let highArpStep = 0; // Track arpeggiator position independently 

function scheduleNote(beatNumber, time) {
    const step = beatNumber % 8; // 8 beat loop
    
    // Track this beat for click detection
    activeBeats.push({ time: time, hit: false, missed: false, beatNumber: beatNumber });

    // --- DRUMS ---
    const oscDrum = audioContext.createOscillator();
    const gainDrum = audioContext.createGain();
    oscDrum.connect(gainDrum);
    gainDrum.connect(audioContext.destination);

    // Kick on 0, 4 (Standard 4/4 kicks on 1 and 3)
    // Snare on 2, 6 (Standard 4/4 snares on 2 and 4)
    // Hi-hats on all?
    // Let's do a driving kick every beat for "hypnotic"
    oscDrum.frequency.setValueAtTime(150, time);
    oscDrum.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
    
    // Accentuate beats 0 and 4 as heavy kicks, others slightly lighter?
    // Let's stick to the previous Kick/Snare pattern but make it tighter
    if (beatNumber % 2 === 0) {
        // Kick
        gainDrum.gain.setValueAtTime(1.0, time);
        gainDrum.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
    } else {
        // Snare/Hat
        oscDrum.frequency.setValueAtTime(400, time); 
        oscDrum.frequency.exponentialRampToValueAtTime(0.01, time + 0.1); // Sharper
        gainDrum.gain.setValueAtTime(0.6, time);
        gainDrum.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    }
    oscDrum.start(time);
    oscDrum.stop(time + 0.5);

    // --- DOUBLE DRUM HIT (every 16 beats) - in time with bass, player clicks both ---
    if (beatNumber % 16 === 0 && beatNumber > 0) {
        const secondsPerBeat = 60.0 / currentTempo;
        const halfBeat = secondsPerBeat / 2;
        
        // Second hit on the half-beat (first hit is the regular drum above)
        const doubleTime = time + halfBeat;
        
        // Add half-beat to activeBeats so player must click it too
        activeBeats.push({ time: doubleTime, hit: false, missed: false, beatNumber: beatNumber + 0.5, isDouble: true });
        
        const oscDouble = audioContext.createOscillator();
        const gainDouble = audioContext.createGain();
        oscDouble.connect(gainDouble);
        gainDouble.connect(audioContext.destination);
        
        // High tom sound for the double hit
        oscDouble.frequency.setValueAtTime(250, doubleTime);
        oscDouble.frequency.exponentialRampToValueAtTime(125, doubleTime + 0.1);
        
        gainDouble.gain.setValueAtTime(0.8, doubleTime);
        gainDouble.gain.exponentialRampToValueAtTime(0.01, doubleTime + 0.1);
        
        oscDouble.start(doubleTime);
        oscDouble.stop(doubleTime + 0.15);
    }

    // --- BASS ---
    const oscBass = audioContext.createOscillator();
    const gainBass = audioContext.createGain();
    oscBass.type = 'triangle'; // Smoother, deeper
    oscBass.connect(gainBass);
    gainBass.connect(audioContext.destination);

    const bassFreq = BASS_FREQS[step];
    oscBass.frequency.setValueAtTime(bassFreq, time);
    gainBass.gain.setValueAtTime(0.5, time);
    gainBass.gain.linearRampToValueAtTime(0, time + 0.3); // Short pluck

    oscBass.start(time);
    oscBass.stop(time + 0.4);

    // --- MELODY ---
    // Play melody every 2 beats? or on off-beats?
    // Let's play sparse melody notes
    const melodyFreq = MELODY_FREQS[step];
    if (melodyFreq > 0) {
        const oscMel = audioContext.createOscillator();
        const gainMel = audioContext.createGain();
        oscMel.type = 'sine'; // Pure hypnotic
        oscMel.connect(gainMel);
        gainMel.connect(audioContext.destination);

        oscMel.frequency.setValueAtTime(melodyFreq, time);
        // Slight vibrato/slide?
        oscMel.frequency.linearRampToValueAtTime(melodyFreq * 0.99, time + 0.4);

        gainMel.gain.setValueAtTime(0.15, time); // Quiet background
        gainMel.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        oscMel.start(time);
        oscMel.stop(time + 0.6);
    }

    // --- HIGH ENERGY MELODY (> 120 BPM) - Double notes, 3 octave arpeggiator ---
    if (currentTempo > 120) {
        const secondsPerBeat = 60.0 / currentTempo;
        const halfBeat = secondsPerBeat / 2;
        
        // Fade in volume based on how far above 120 we are
        // Max volume at 160 BPM
        let volume = Math.min(0.12, (currentTempo - 120) / 200.0);
        
        // Play TWO notes per beat (double the bass rate)
        for (let i = 0; i < 2; i++) {
            const noteTime = time + (i * halfBeat);
            const arpFreq = HIGH_ARPEGGIO_FREQS[highArpStep % 16];
            highArpStep++;
            
            const oscHigh = audioContext.createOscillator();
            const gainHigh = audioContext.createGain();
            oscHigh.type = 'sawtooth'; // Brighter, more synth-like for arpeggios
            oscHigh.connect(gainHigh);
            gainHigh.connect(audioContext.destination);

            oscHigh.frequency.setValueAtTime(arpFreq, noteTime);
            
            // Staccato envelope for that classic arpeggiator feel
            gainHigh.gain.setValueAtTime(volume, noteTime);
            gainHigh.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.15);

            oscHigh.start(noteTime);
            oscHigh.stop(noteTime + 0.2);
        }
    }
}

function scheduler() {
    // Schedule ahead
    while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD_TIME) {
        scheduleNote(beatCount, nextNoteTime);
        
        // Calculate seconds per beat based on CURRENT tempo
        const secondsPerBeat = 60.0 / currentTempo;
        
        nextNoteTime += secondsPerBeat;
        beatCount++;
    }
}


function handleGameOver() {
    isFinished = true;
    isRunning = false;
    if (audioContext) audioContext.suspend();
    
    runner.setAnimation(0, 'death', false); // Play death animation
    
    const finalDistance = Math.floor(distance);
    instructionsText.setText('GAME OVER\nDISTANCE: ' + finalDistance + 'M\nBEST BPM: ' + Math.floor(highestBpm) + '\nTAP TO RESTART');
    instructionsText.setVisible(true);
}

function handleRestart() {
    // Restart endless runner
    if (!isFinished) return;
    
    distance = 0;
    currentSpeed = 0;
    isFinished = false;
    isRunning = false;
    isCountingDown = false;
    showDotsInCountdown = false;
    countdownNumber = 3;
    startTime = 0;
    currentTempo = START_BPM;
    combo = 0;
    highArpStep = 0;
    activeBeats = [];
    beatCount = 0;
    
    runner.setAnimation(0, 'idle', true);
    instructionsText.setText('TAP TO START!\nHIT THE BEATS\nRUN FOREVER');
    instructionsText.setVisible(true);
    comboText.setVisible(false);
    if (countdownText) countdownText.setVisible(false);
    bpmText.setText(START_BPM + ' BPM');
    updateBars();
}

    const scene = game.scene.scenes[0]; // Need to define scene here for tweens above if not already done?
    // Wait, handleInput is not inside the scene context directly if called via arrow function, 
    // but 'this' inside handleInput might not be the scene if called as a standalone function.
    // In create(), we did: this.input.on('pointerdown', () => { handleInput(); });
    // handleInput is a standalone function in this module scope.
    // 'game' variable is available globally in this module.
    // So const scene = game.scene.scenes[0]; is correct way to get scene reference.
    
    // BUT, I used 'scene' inside the if block for tweens before defining it.
    // I need to move 'const scene = ...' to the TOP of handleInput.
    
    // Let me fix that. I'll replace the top of handleInput.
    
function handleInput() {
    if (isFinished) {
        // Game Over - restart endless runner
        handleRestart();
        return;
    } 

    // Define scene early
    const scene = game.scene.scenes[0];
    
    // Check if game is not running (e.g. first start OR after level reset)
    if (!isRunning && !isCountingDown) {
        if (!isAudioStarted) {
            initAudio();
        }
        instructionsText.setVisible(false);
        
        // Start countdown
        isCountingDown = true;
        countdownNumber = 3;
        
        // Create countdown text
        if (!countdownText) {
            countdownText = scene.add.text(scene.sys.game.config.width / 2, scene.sys.game.config.height / 2, '3', 
                { font: '900 120px sans-serif', fill: '#ff6347' }).setOrigin(0.5);
            countdownText.setDepth(100);
        }
        countdownText.setText('3');
        countdownText.setVisible(true);
        countdownText.setScale(1);
        
        // Animate countdown with beat timing
        const spb = 60.0 / currentTempo;
        
        // 3
        scene.tweens.add({
            targets: countdownText,
            scale: 1.5,
            alpha: 0.5,
            duration: spb * 1000 * 0.8,
            onComplete: () => {
                countdownText.setText('2');
                countdownText.setScale(1);
                countdownText.setAlpha(1);
                
                // 2
                scene.tweens.add({
                    targets: countdownText,
                    scale: 1.5,
                    alpha: 0.5,
                    duration: spb * 1000 * 0.8,
                    onComplete: () => {
                        countdownText.setText('1');
                        countdownText.setScale(1);
                        countdownText.setAlpha(1);
                        
                        // Start showing dots now - first beat will arrive at center when "1" ends
                        showDotsInCountdown = true;
                        nextNoteTime = audioContext.currentTime + spb; // First beat arrives in 1 beat
                        beatCount = 0;
                        activeBeats = [];
                        
                        // 1
                        scene.tweens.add({
                            targets: countdownText,
                            scale: 1.5,
                            alpha: 0.5,
                            duration: spb * 1000 * 0.8,
                            onComplete: () => {
                                countdownText.setVisible(false);
                                isCountingDown = false;
                                showDotsInCountdown = false;
                                isRunning = true;
                                startTime = Date.now();
                                runner.setAnimation(0, 'run', true);
                            }
                        });
                    }
                });
            }
        });
        return; 
    }
    
    // Ignore input during countdown
    if (isCountingDown) {
        return;
    }

    // Rhythm Accuracy Check
    const currentTime = audioContext.currentTime;
    
    // Find the closest beat in activeBeats
    let closestBeatIndex = -1;
    let minDiff = Infinity;
    
    for (let i = 0; i < activeBeats.length; i++) {
        const diff = Math.abs(activeBeats[i].time - currentTime);
        if (diff < minDiff) {
            minDiff = diff;
            closestBeatIndex = i;
        }
    }
    
    // Fallback to legacy calculation if no active beats (shouldn't happen often)
    // Actually, let's trust activeBeats if available
    let error = minDiff;
    let targetBeat = null;
    
    if (closestBeatIndex !== -1) {
        targetBeat = activeBeats[closestBeatIndex];
        // If this beat was already hit or missed, we might be hitting it again or hitting a ghost note
        // Ideally we should find the closest UNHIT beat, but maybe user is spamming.
        // Let's stick to closest beat regardless of state for error calculation, 
        // but mark it HIT if valid.
    } else {
        // Legacy fallback
        const spb = 60.0 / currentTempo;
        const prevNoteTime = nextNoteTime - spb;
        const distToNext = Math.abs(nextNoteTime - currentTime);
        const distToPrev = Math.abs(prevNoteTime - currentTime);
        error = Math.min(distToNext, distToPrev);
    }
    
    const width = game.config.width;
    const centerX = width / 2;
    
    let speedBoost = 0;
    let hitColor = 0xff0000;
    
    // Tightened "Perfect" window to 0.025s (25ms) for "100% on the beat" feel
    if (error < 0.025) {
        if (targetBeat) targetBeat.hit = true; // Mark beat as hit
        speedBoost = SPEED_GAIN_PER_HIT * 1.5;
        hitColor = 0x00ff00; 
        createFloatingText(runner.x, runner.y - 100, "PERFECT!", '#00ff00');
        
        // Increase BPM on Perfect Hit
        // Combo logic: 
        // 1st hit (combo 0 -> 1): +1
        // 2nd hit (combo 1 -> 2): +2
        // 3rd hit (combo 2 -> 3): +3
        combo++;
        const bpmIncrease = combo;
        currentTempo += bpmIncrease;
        
        // Track highest BPM reached
        if (currentTempo > highestBpm) {
            highestBpm = currentTempo;
            highBpmText.setText('BEST BPM: ' + Math.floor(highestBpm));
        }
        
        bpmText.setText(Math.floor(currentTempo) + ' BPM');
        comboText.setText('COMBO: ' + combo + 'x');
        comboText.setVisible(true);
        comboText.setScale(2.5);
        if (scene) {
            scene.tweens.add({
                targets: comboText,
                scale: 1,
                duration: 200,
                ease: 'Back.out'
            });
        }
        
    } else if (error < 0.15) {
        if (targetBeat) targetBeat.hit = true; // Mark beat as hit
        speedBoost = SPEED_GAIN_PER_HIT;
        hitColor = 0xffaa00; 
        createFloatingText(runner.x, runner.y - 100, "GOOD", '#ffaa00');
        
        // Reset Combo on non-perfect
        combo = 0;
        comboText.setVisible(false);

        // Decrease BPM on Good Hit (-5)
        // Allow dropping below START_BPM, down to 0 for Game Over
        currentTempo = Math.max(0, currentTempo - 3);
        if (currentTempo <= 0) handleGameOver();
        bpmText.setText(Math.floor(currentTempo) + ' BPM');

    } else {
        // Miss (Red Click)
        // Don't mark targetBeat as hit, so it might still count as missed beat? 
        // No, if they clicked and missed, we penalize them here.
        // If we don't mark it hit, the 'Missed Beat' logic in update might ALSO trigger.
        // Double penalty? 
        // Let's mark it hit so we don't double penalize for the SAME beat index.
        if (targetBeat) targetBeat.hit = true; 
        
        speedBoost = -50; 
        hitColor = 0xff0000; 
        createFloatingText(runner.x, runner.y - 100, "MISS", '#ff0000');
        
        // Play Stumble/Hit Animation
        // Play 'hit' animation once, then return to run
        runner.setAnimation(0, 'hit', false);
        // Queue the next animation based on tempo
        const nextAnim = 'run';
        runner.addAnimation(0, nextAnim, true, 0);
        
        // Reset Combo
        combo = 0;
        comboText.setVisible(false);

        // Decrease BPM significantly on Miss (-10)
        // Allow dropping below START_BPM, down to 0 for Game Over
        currentTempo = Math.max(0, currentTempo - 10);
        if (currentTempo <= 0) handleGameOver();
        bpmText.setText(Math.floor(currentTempo) + ' BPM');
    }
    
    const marker = scene.add.circle(centerX, BEAT_BAR_Y, 30, hitColor);
    marker.setStrokeStyle(3, 0x000000);
    marker.setDepth(100); // Ensure marker is on top of EVERYTHING
    scene.tweens.add({
        targets: marker,
        scale: 1.5,
        alpha: 0,
        duration: 200,
        onComplete: () => marker.destroy()
    });
    
    currentSpeed += speedBoost;
    if (currentSpeed > maxSpeedLimit) currentSpeed = maxSpeedLimit;
    if (currentSpeed < 0) currentSpeed = 0;
}

function createFloatingText(x, y, message, color) {
    const scene = game.scene.scenes[0];
    if (scene) {
        const text = scene.add.text(x, y, message, { font: '900 20px sans-serif', fill: color }).setOrigin(0.5);
        text.setStroke('#000000', 3);
        scene.tweens.add({
            targets: text,
            y: y - 50,
            alpha: 0,
            duration: 500,
            onComplete: () => text.destroy()
        });
    }
}

function update(time, delta) {
    if (isAudioStarted && !isFinished && !isCountingDown) {
        scheduler();
    }

    if (isFinished) return;
    
    // Visual Beat Bar Logic - show during countdown too
    if (isAudioStarted || isCountingDown) {
        const width = this.sys.game.config.width;
        beatBar.clear();
        
    // Transparent background - no fill
    
    // Draw Piano Score (5 lines) - subtle transparent lines, twice as big spacing
    beatBar.lineStyle(3, 0x000000, 0.2);
    for (let i = -2; i <= 2; i++) {
         beatBar.lineBetween(0, BEAT_BAR_Y + (i * 20), width, BEAT_BAR_Y + (i * 20));
    }
    
    // Draw Center Target Line (Vertical) - more visible, taller
    beatBar.lineStyle(4, 0xffffff, 0.8);
    beatBar.lineBetween(width / 2, BEAT_BAR_Y - 50, width / 2, BEAT_BAR_Y + 50);
    
    const currentTime = audioContext.currentTime;
    const centerX = width / 2;
    
    const startBeat = beatCount - 5;
    const endBeat = beatCount + 5;
    
    beatBar.fillStyle(0xcccccc, 1);
    beatBar.lineStyle(3, 0x000000, 1); // Black outline, thicker
    
    const currentSPB = 60.0 / currentTempo;
    
    // --- Missed Beat Detection (skip during countdown) ---
    // Check if we missed any beats in activeBeats
    // A beat is missed if currentTime > beatTime + 0.15 (Good Window) and !beat.hit
    if (!isCountingDown) { // Only detect misses when game is running
    for (let i = activeBeats.length - 1; i >= 0; i--) {
        const beat = activeBeats[i];
        if (!beat.hit && !beat.missed) {
            if (currentTime > beat.time + 0.15) {
                // Missed beat logic
                beat.missed = true;
                
                // Penalty for missed beat (-10 BPM)
                currentTempo -= 10;
                
                // Game Over Check
                if (currentTempo <= 0) {
                    currentTempo = 0;
                    handleGameOver();
                }
                
                bpmText.setText(Math.floor(currentTempo) + ' BPM');
                createFloatingText(runner.x, runner.y - 100, "MISSED BEAT", '#ff0000');
                
                // Reset Combo
                combo = 0;
                comboText.setVisible(false);
            }
        }
        
        // Remove old beats to keep array small
        if (currentTime > beat.time + 2.0) {
            activeBeats.splice(i, 1);
        }
    }
    
    } // End of missed beat detection
    
    // --- Draw beat dots (when running OR during final countdown phase) ---
    if (!isCountingDown || showDotsInCountdown) {
    for (let i = startBeat; i < endBeat; i++) {
            const offset = i - beatCount;
            const beatTime = nextNoteTime + offset * currentSPB;
            
            const timeDiff = beatTime - currentTime;
            const x = centerX + timeDiff * BEAT_SPEED;
            
            if (x > -30 && x < width + 30) {
                 beatBar.fillCircle(x, BEAT_BAR_Y, 24); // Twice as big dots
                 beatBar.strokeCircle(x, BEAT_BAR_Y, 24); // With outline
                 
                 // Draw double beat indicator (half-beat) every 16 beats
                 if (i % 16 === 0 && i > 0) {
                     const halfBeatTime = beatTime + (currentSPB / 2);
                     const halfTimeDiff = halfBeatTime - currentTime;
                     const halfX = centerX + halfTimeDiff * BEAT_SPEED;
                     
                     if (halfX > -30 && halfX < width + 30) {
                         beatBar.fillStyle(0xff6600, 1); // Orange for double beat
                         beatBar.fillCircle(halfX, BEAT_BAR_Y, 20);
                         beatBar.strokeCircle(halfX, BEAT_BAR_Y, 20);
                         beatBar.fillStyle(0xcccccc, 1); // Reset fill color
                     }
                 }
            }
        }
    } // End of !isCountingDown check
    // -----------------------------
    }

    const width = this.sys.game.config.width;
    const height = this.sys.game.config.height;

    // Scroll Backgrounds
    // Parallax: Background moves slow, Foreground moves fast (same as player perception)
    if (currentSpeed > 0) {
        // Adjust scroll speed based on currentSpeed
        // Background scroll factor
        background.tilePositionX += (currentSpeed * delta / 1000) * 0.2; // Slower
        foreground.tilePositionX += (currentSpeed * delta / 1000) * 1.0; // Faster (Normal speed)
    }

    if (currentSpeed > 0) {
        currentSpeed -= SPEED_DECAY * (delta / 16.66); 
        if (currentSpeed < 0) currentSpeed = 0;
        
        distance += (currentSpeed * delta) / 100000; 
    }

    if (isRunning && !isFinished) {
        const currentTime = (Date.now() - startTime) / 1000;
        timerText.setText('TIME: ' + currentTime.toFixed(2) + 'S');
        
        // Update BPM Text position if needed (but fixed is fine too)
        // bpmText.setText(Math.floor(currentTempo) + ' BPM'); // Updated in handleInput to save calls
    }

    updateBars();
    // drawScene(this, width, height, currentSpeed); // OLD: Don't draw line floor if using images
    drawBackground(width, height);

    if (isRunning && !isFinished) {
        // Continuous Animation based on BPM
        // Determine correct animation based on BPM
        // Always RUN, just slower/faster
        // Unless 'hit' or 'death' is playing
        const currentAnim = runner.getCurrentAnimation().name;
        if (currentAnim === 'hit' || currentAnim === 'death') {
            // Do nothing, let it play out
        } else {
            const targetAnim = 'run';
            if (currentAnim !== targetAnim) {
                 runner.setAnimation(0, targetAnim, true);
            }
            
            // Sync timeScale to BPM. 
            // For 'run': 120 BPM = 1.0 (Standard)
            // At 40 BPM -> 0.33x speed. 
            // This ensures it looks like running but just in slow motion matching the beat.
            const targetTimeScale = currentTempo / 120.0;
            
            runner.timeScale = targetTimeScale;
        }
    }
}

// Deprecated or Modified Draw Scene
function drawScene(scene, width, height, speed) {
    // Only draw distance markers now since floor is handled by images?
    // Let's hide the old floor lines to not conflict with images
    floor.clear();
    
    // We still need to update markers position though
    const runnerScreenX = width * 0.3; 
    distanceMarkers.forEach(marker => {
        const x = runnerScreenX + (marker.meter - distance) * PIXELS_PER_METER;
        if (x > -50 && x < width + 50) {
            marker.text.setX(x);
            marker.text.setVisible(true);
        } else {
            marker.text.setVisible(false);
        }
    });
}

function drawBackground(width, height) {
    // Override old drawBackground to do nothing, since we use TileSprites now
    // Or we could use this for sky color if the image is transparent?
    // Assuming background.png covers it.
    // But let's keep sky color just in case background has transparency or doesn't cover all.
    // Actually, TileSprite is added to scene, this graphics object is different.
    // Let's clear the old graphics background
    // background is now a TileSprite variable, shadowing the old graphics variable?
    // Wait, in create() I assigned background = add.tileSprite...
    // So 'background' variable is now a TileSprite, not Graphics.
    // Calling .clear() on it will crash.
    // I should rename the variable or remove this function's logic.
    // I will remove the call to this function in update()
}

function updateBars() {
    // Endless mode - just update distance text
    distanceText.setText('DISTANCE: ' + Math.floor(distance) + 'M');
}
