import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import './Numbers1To10App.css';

const NUMBER_WORDS = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten'
};

/**
 * Numbers1To10App — Hopscotch Mat Adventure
 *
 * Dedicated Number Foundations module:
 * - Start position for Bunny outside the 10-card mat (Position 0).
 * - Left & Right Arrow controls to hop over the pads step-by-step.
 * - When die rolls N, the first N cards glow.
 * - As Bunny hops over each pad, it stops glowing.
 * - Cards are hidden initially; when Bunny reaches the target card,
 *   it flips, reveals the numeral, speaks the number name, and celebrates!
 */
export default function Numbers1To10App({
  onBack,
  completedTopics = [],
  markTopicCompleted,
  updateCoins
}) {
  const [starCount, setStarCount] = useState(0);
  const [starBump, setStarBump] = useState(false);

  // Bunny Position: 0 = Start Burrow (outside mat), 1..10 = Number Cards
  const [bunnyPos, setBunnyPos] = useState(0);
  const [bunnyHopSpring, setBunnyHopSpring] = useState(false);
  const [bunnyYayVisible, setBunnyYayVisible] = useState(false);

  // Target count from dice roll (1 to 10)
  const [gameDiceTarget, setGameDiceTarget] = useState(0);
  const [gameDiceRolling, setGameDiceRolling] = useState(false);
  const [hasRolled, setHasRolled] = useState(false);
  // Dice values: [val] for 1..6, [val1, val2] for 7..10 with non-repeating numbers
  const [currentDiceValues, setCurrentDiceValues] = useState([0]);

  // Non-repeating random number pool (ensures numbers 1..10 cycle without immediate repeats)
  const remainingNumbersRef = useRef([]);
  const lastRolledNumberRef = useRef(null);

  // Currently revealed pad for this round (revealed ONLY when reaching the right card!)
  const [revealedPad, setRevealedPad] = useState(null);
  const [discoveredNumbers, setDiscoveredNumbers] = useState(new Set());

  // Round message & lock
  const [feedbackMsg, setFeedbackMsg] = useState('🎲 Roll the die to play!');
  const [targetReached, setTargetReached] = useState(false);

  // Auto-roll timer ref
  const autoRollTimerRef = useRef(null);

  // Dedicated Confetti Canvas Instance Ref (prevents body insertion & scrollbar flicker)
  const confettiCanvasRef = useRef(null);
  const confettiInstanceRef = useRef(null);

  useEffect(() => {
    if (confettiCanvasRef.current && typeof confetti === 'function' && typeof confetti.create === 'function') {
      try {
        confettiInstanceRef.current = confetti.create(confettiCanvasRef.current, {
          resize: true,
          useWorker: true
        });
      } catch {
        // Fallback to default
      }
    }
    return () => {
      if (confettiInstanceRef.current) {
        try {
          confettiInstanceRef.current.reset();
        } catch {
          // Safe fallback
        }
      }
    };
  }, []);

  // Modals
  const [tutorialModalOpen, setTutorialModalOpen] = useState(false);
  const [rewardModal, setRewardModal] = useState({ open: false, title: '', subtitle: '', emoji: '⭐' });

  // Web Audio Context Ref
  const audioCtxRef = useRef(null);

  // ==========================================
  // WEB AUDIO SYNTHESIZER
  // ==========================================
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtxRef.current = new AudioContextClass();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const sfxTone = useCallback((freq, type = 'sine', duration = 0.12, gainLvl = 0.15) => {
    try {
      initAudio();
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainLvl, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio fallback
    }
  }, [initAudio]);

  const sfxClick = useCallback(() => {
    sfxTone(400, 'triangle', 0.05, 0.12);
  }, [sfxTone]);

  const sfxSuccess = useCallback(() => {
    setTimeout(() => sfxTone(523.25, 'triangle', 0.12, 0.2), 0);
    setTimeout(() => sfxTone(659.25, 'triangle', 0.12, 0.2), 90);
    setTimeout(() => sfxTone(783.99, 'triangle', 0.16, 0.2), 180);
    setTimeout(() => sfxTone(1046.50, 'triangle', 0.26, 0.25), 270);
  }, [sfxTone]);

  const sfxBoing = useCallback(() => {
    sfxTone(350, 'sine', 0.08, 0.2);
    setTimeout(() => sfxTone(550, 'sine', 0.12, 0.2), 60);
  }, [sfxTone]);

  const sfxDiceRoll = useCallback(() => {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        sfxTone(240 + Math.random() * 260, 'square', 0.04, 0.06);
      }, i * 50);
    }
  }, [sfxTone]);

  // Voice speech pronunciation
  const speakNumberName = useCallback((num) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const word = NUMBER_WORDS[num] || String(num);
        const utt = new SpeechSynthesisUtterance(word);
        utt.rate = 0.85;
        utt.pitch = 1.15;
        window.speechSynthesis.speak(utt);
      } catch {
        // Fallback
      }
    }
  }, []);

  const awardStars = useCallback((qty = 2) => {
    setStarCount(prev => prev + qty);
    setStarBump(true);
    setTimeout(() => setStarBump(false), 400);

    if (confettiInstanceRef.current) {
      try {
        confettiInstanceRef.current({
          particleCount: 35 + qty * 10,
          spread: 60,
          origin: { y: 0.7 }
        });
      } catch {
        // Fallback
      }
    } else if (typeof confetti === 'function') {
      confetti({
        particleCount: 35 + qty * 10,
        spread: 60,
        origin: { y: 0.7 }
      });
    }

    if (typeof updateCoins === 'function') {
      try {
        updateCoins(qty);
      } catch {
        // Safe fallback
      }
    }
    if (typeof markTopicCompleted === 'function') {
      try {
        markTopicCompleted('numbers-1-to-10');
      } catch {
        // Safe fallback
      }
    }
  }, [updateCoins, markTopicCompleted]);

  // Helper to pick next number (1 to 10) guaranteeing no consecutive repeats
  const getNextRandomNumber = useCallback(() => {
    if (remainingNumbersRef.current.length === 0) {
      const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      // Fisher-Yates shuffle
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      // If the next number to pop matches the last rolled number, swap it with another index
      if (lastRolledNumberRef.current !== null && pool[pool.length - 1] === lastRolledNumberRef.current) {
        const swapIdx = Math.floor(Math.random() * (pool.length - 1));
        [pool[pool.length - 1], pool[swapIdx]] = [pool[swapIdx], pool[pool.length - 1]];
      }
      remainingNumbersRef.current = pool;
    }

    let next = remainingNumbersRef.current.pop();

    // Absolute safeguard: if somehow identical to previous roll, swap or pick alternative
    if (next === lastRolledNumberRef.current) {
      if (remainingNumbersRef.current.length > 0) {
        const alt = remainingNumbersRef.current.pop();
        remainingNumbersRef.current.push(next);
        next = alt;
      } else {
        const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(n => n !== lastRolledNumberRef.current);
        next = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }

    lastRolledNumberRef.current = next;
    return next;
  }, []);

  // Split target numbers into dice values (1..6: 1 die; 7..10: 2 dice with non-repeating numbers)
  const DICE_SPLITS = {
    7: [4, 3],
    8: [5, 3],
    9: [5, 4],
    10: [6, 4]
  };

  // Roll die with random count from 1 to 10
  const rollGameDice = useCallback(() => {
    if (gameDiceRolling) return;
    if (autoRollTimerRef.current) clearTimeout(autoRollTimerRef.current);
    sfxDiceRoll();
    setGameDiceRolling(true);
    setTargetReached(false);
    setRevealedPad(null); // Cards reset to blank for the new roll!
    setBunnyPos(0); // Reset bunny to start burrow above cards
    setBunnyYayVisible(false);

    setTimeout(() => {
      const next = getNextRandomNumber();
      setGameDiceTarget(next);
      if (next <= 6) {
        setCurrentDiceValues([next]);
      } else {
        setCurrentDiceValues(DICE_SPLITS[next] || [Math.ceil(next / 2), Math.floor(next / 2)]);
      }
      setHasRolled(true);
      setGameDiceRolling(false);
      setFeedbackMsg(`🐰 Hop ${next} times!`);
    }, 280);
  }, [gameDiceRolling, getNextRandomNumber, sfxDiceRoll]);

  // Check if bunny has landed on target
  const handleBunnyLanded = useCallback((newPos, target) => {
    if (newPos === target) {
      setTargetReached(true);
      sfxSuccess();
      awardStars(2);

      // Flip & reveal ONLY this right card!
      setRevealedPad(target);
      setDiscoveredNumbers(prev => new Set(prev).add(target));

      // Announce the number name via Speech Synthesis!
      speakNumberName(target);

      setBunnyYayVisible(true);
      setFeedbackMsg(`🎉 You reached ${target}!`);

      // Auto roll next round after celebration
      if (autoRollTimerRef.current) clearTimeout(autoRollTimerRef.current);
      autoRollTimerRef.current = setTimeout(() => {
        rollGameDice();
      }, 3200);
    } else if (newPos > target) {
      sfxBoing();
      setFeedbackMsg(`◀ Step back to ${target}!`);
    } else {
      const left = target - newPos;
      setFeedbackMsg(`🥕 ${left} more to go!`);
    }
  }, [awardStars, rollGameDice, sfxBoing, sfxSuccess, speakNumberName]);

  // Hop to a specific position with animation
  const hopToPosition = useCallback((targetPos) => {
    sfxBoing();
    setBunnyHopSpring(true);
    setBunnyPos(targetPos);

    setTimeout(() => {
      setBunnyHopSpring(false);
      handleBunnyLanded(targetPos, gameDiceTarget);
    }, 320);
  }, [gameDiceTarget, handleBunnyLanded, sfxBoing]);

  // Arrow control: Hop Right (forward)
  const hopRight = useCallback(() => {
    if (!hasRolled) {
      setFeedbackMsg('🎲 Roll the die first!');
      sfxBoing();
      return;
    }
    if (bunnyPos >= 10 || gameDiceRolling) return;
    hopToPosition(bunnyPos + 1);
  }, [hasRolled, bunnyPos, gameDiceRolling, hopToPosition, sfxBoing]);

  // Arrow control: Hop Left (backward)
  const hopLeft = useCallback(() => {
    if (!hasRolled) {
      setFeedbackMsg('🎲 Roll the die first!');
      sfxBoing();
      return;
    }
    if (bunnyPos <= 0 || gameDiceRolling) return;
    hopToPosition(bunnyPos - 1);
  }, [hasRolled, bunnyPos, gameDiceRolling, hopToPosition, sfxBoing]);

  // Keyboard navigation for arrow keys
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Right') {
        e.preventDefault();
        hopRight();
      } else if (e.key === 'ArrowLeft' || e.key === 'Left') {
        e.preventDefault();
        hopLeft();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hopRight, hopLeft]);

  // Clean up auto-roll timer on unmount
  useEffect(() => {
    return () => {
      if (autoRollTimerRef.current) clearTimeout(autoRollTimerRef.current);
    };
  }, []);

  // Dice Pip Face Component (Standard 1 to 6 dots on 3x3 grid)
  const DiceFace = ({ count, isDuo = false }) => {
    const pipBg = '#111827';

    if (!hasRolled || count <= 0) {
      return (
        <div className="dice-unrolled-face">
          <span style={{ fontSize: isDuo ? '1.5rem' : '2.1rem' }}>🎲</span>
          <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#111827', textTransform: 'uppercase' }}>
            Roll!
          </span>
        </div>
      );
    }

    const pipMap = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8]
    };
    const pips = pipMap[count] || [];
    const dotSize = isDuo ? '11px' : '13px';

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          width: '100%',
          height: '100%',
          padding: isDuo ? '3px' : '4px',
          gap: isDuo ? '2px' : '3px',
          placeItems: 'center'
        }}
      >
        {Array.from({ length: 9 }).map((_, idx) => (
          <div
            key={idx}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: '50%',
              background: pips.includes(idx) ? pipBg : 'transparent',
              boxShadow: pips.includes(idx) ? 'inset 0 1.5px 2px rgba(0,0,0,0.45)' : 'none'
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="numbers-app-wrapper">
      {/* Permanent Fixed Confetti Canvas (zero body injection, zero scrollbar flicker) */}
      <canvas ref={confettiCanvasRef} className="numbers-confetti-canvas" />

      {/* ============================================================ */}
      {/* HEADER NAVBAR                                                */}
      {/* ============================================================ */}
      <header className="numbers-nav-bar">
        <div className="numbers-nav-left">
          <button
            type="button"
            className="numbers-back-btn"
            onClick={onBack}
            title="Return to Menu"
          >
            ← Back
          </button>
          <div className="numbers-header-title">
            <h2>Tenali · Numbers 1 to 10</h2>
            <span className="numbers-header-subtitle">Hop with Bunny! 🐰</span>
          </div>
        </div>

        <div className="numbers-nav-right">
          <div className={`numbers-star-pill ${starBump ? 'bump' : ''}`} title="Stars Earned">
            <span>⭐</span>
            <span>{starCount}</span>
          </div>
        </div>
      </header>

      {/* ============================================================ */}
      {/* HOPSCOTCH MAT ADVENTURE GAME                                 */}
      {/* ============================================================ */}
      <section className="numbers-card">
        {/* Compact Section Header */}
        <div className="numbers-section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: 'clamp(1.2rem, 2.2vw, 1.45rem)' }}>
              🐰 Hopscotch (1 to 10)
            </h1>
          </div>

          <button
            type="button"
            className="numbers-btn-secondary"
            style={{ fontSize: '0.8rem', padding: '5px 14px' }}
            onClick={() => setTutorialModalOpen(true)}
          >
            <span>❓ Help</span>
          </button>
        </div>

        {/* ============================================================ */}
        {/* UNIFIED GAME CONTAINER (DICE + MAT + BUTTONS ALL TOGETHER)   */}
        {/* ============================================================ */}
        <div className="bunny-track-container unified-arena">

          {/* 1. TOP: DICE & TARGET CONTROLS (LOCKED STATIC HEIGHT) */}
          <div className="arena-dice-bar">
            <div className="arena-dice-left-group">
              <div
                className="dice-display-area"
                onClick={rollGameDice}
                title="Tap dice to roll"
              >
                {currentDiceValues.map((val, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="dice-plus-badge">+</span>}
                    <div
                      className={`dice-cube compact ${currentDiceValues.length > 1 ? 'duo' : ''} ${gameDiceRolling ? 'rolling' : ''}`}
                    >
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <DiceFace count={val} isDuo={currentDiceValues.length > 1} />
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>

              <button
                type="button"
                className="numbers-btn-primary compact"
                onClick={rollGameDice}
                disabled={gameDiceRolling}
              >
                <span>🎲</span> <span>{hasRolled ? 'Roll Again' : 'Roll!'}</span>
              </button>

              <p className="arena-feedback-msg" title={feedbackMsg}>
                {feedbackMsg}
              </p>
            </div>

            <div className="numbers-status-pill compact arena-goal-pill">
              <span>
                {hasRolled
                  ? (gameDiceTarget > 6 && currentDiceValues.length === 2
                      ? `🎯 ${currentDiceValues[0]} + ${currentDiceValues[1]} = ${gameDiceTarget}`
                      : `🎯 Goal: ${gameDiceTarget}`)
                  : '🎲 Roll!'}
              </span>
            </div>
          </div>

          {/* 2. MIDDLE: THE MAT (100% WIDTH, NO HORIZONTAL SCROLL) */}
          <div className="bunny-track-arena">
            {/* Floating Bunny Token */}
            <div
              className={`bunny-avatar-token ${bunnyHopSpring ? 'hop-spring' : ''}`}
              style={{
                top: bunnyPos === 0 ? '4px' : '56px',
                left: `calc(${bunnyPos === 0 ? 0 : bunnyPos - 1} * (10% + 0.6px))`,
                width: 'calc(10% - 5.4px)'
              }}
            >
              {bunnyYayVisible && (
                <div className="bunny-yay-bubble">
                  ⭐ {gameDiceTarget}! {NUMBER_WORDS[gameDiceTarget]}!
                </div>
              )}
              <span className="bunny-emoji">🐰</span>
            </div>

            {/* Row 1: Start Position (Burrow above Card 1) + Visual Carrot Path */}
            <div className="track-top-row">
              {/* Column 1: Start Burrow directly above Card 1 */}
              <div
                className={`start-burrow-above ${bunnyPos === 0 ? 'is-active-spot' : ''}`}
              >
                <span className="start-burrow-badge">🌱 START</span>
                <span className="start-burrow-icon" style={{ opacity: bunnyPos === 0 ? 0.35 : 1, fontSize: '1.45rem' }}>🥕</span>
              </div>

              {/* Columns 2-10: Visual Carrot Trail (Zero text overload!) */}
              <div className="track-guide-banner carrot-trail">
                {!hasRolled ? (
                  <div className="track-guide-visual">
                    <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--clr-text-soft)' }}>
                      🎲 Roll to start!
                    </span>
                  </div>
                ) : targetReached ? (
                  <div className="track-guide-visual">
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--clr-correct, #5cb87a)' }}>
                      🎉 Found Card {gameDiceTarget}! ⭐ ⭐ ⭐
                    </span>
                  </div>
                ) : (
                  <div className="track-guide-visual">
                    <div className="carrot-dots-list">
                      {Array.from({ length: gameDiceTarget }).map((_, idx) => {
                        const hopStep = idx + 1;
                        const isHopped = bunnyPos >= hopStep;
                        return (
                          <span
                            key={idx}
                            className="carrot-dot"
                            style={{
                              fontSize: isHopped ? '1.15rem' : '1.35rem',
                              opacity: isHopped ? 0.35 : 1,
                              transform: isHopped ? 'scale(0.85)' : 'scale(1.1)',
                              transition: 'all 0.2s ease',
                              display: 'inline-block'
                            }}
                          >
                            {isHopped ? '🐾' : '🥕'}
                          </span>
                        );
                      })}
                    </div>
                    <span className="carrot-goal-badge">➔ ⭐ {gameDiceTarget}</span>
                  </div>
                )}
                <div className="track-target-pill">
                  <span>🎯 {hasRolled ? gameDiceTarget : 'Roll!'}</span>
                </div>
              </div>
            </div>

            {/* Row 2: Hopping Lane between Top Row and Cards */}
            <div className="track-hop-lane" />

            {/* Row 3: 10 Blank Number Cards Mat (Only arrow keys/buttons make bunny hop; no click or hover reveal) */}
            <div className="hop-pads-track">
              {Array.from({ length: 10 }).map((_, i) => {
                const padNum = i + 1;
                const isGlowing = hasRolled && !gameDiceRolling && padNum <= gameDiceTarget && padNum > bunnyPos;
                const isRevealed = revealedPad === padNum;

                let cardInnerClass = 'hop-card-inner';
                if (isRevealed) cardInnerClass += ' is-flipped';
                if (isGlowing) cardInnerClass += ' is-glowing';

                return (
                  <div
                    key={padNum}
                    className="hop-card-container"
                    title={isRevealed ? `${padNum} (${NUMBER_WORDS[padNum]})` : undefined}
                  >
                    <div className={cardInnerClass}>
                      {/* Blank Card Face (Unrevealed - completely blank!) */}
                      <div className="hop-card-face hop-card-back" />

                      {/* Front Face (Revealed Number - shown ONLY upon reaching right card!) */}
                      <div className="hop-card-face hop-card-front">
                        <span className="pad-star-top">⭐</span>
                        <span className="pad-number">{padNum}</span>
                        <span className="pad-word">{NUMBER_WORDS[padNum]}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. BOTTOM: CONTROLS & STEP COUNTER (INSIDE THE CONTAINER) */}
          <div className="hop-controls-bar inside-container">
            <div className="hop-arrow-controls">
              <button
                type="button"
                className="hop-arrow-btn"
                onClick={hopLeft}
                disabled={!hasRolled || bunnyPos <= 0 || gameDiceRolling}
                title="Hop back"
              >
                <span>◀</span> <span>Hop</span>
              </button>

              <button
                type="button"
                className="hop-arrow-btn primary"
                onClick={hopRight}
                disabled={!hasRolled || bunnyPos >= 10 || gameDiceRolling}
                title="Hop forward"
              >
                <span>Hop</span> <span>▶</span>
              </button>
            </div>

            <div className="hop-step-indicator">
              <span>🐰 <strong>{bunnyPos === 0 ? 'Start' : bunnyPos}</strong></span>
              <span>/</span>
              <span>🎯 <strong>{hasRolled ? gameDiceTarget : '?'}</strong></span>
            </div>

            <div className="hop-actions-group">
              <button
                type="button"
                className="numbers-btn-primary next-roll-btn"
                onClick={rollGameDice}
                disabled={gameDiceRolling || !targetReached}
                style={{
                  visibility: targetReached ? 'visible' : 'hidden',
                  pointerEvents: targetReached ? 'auto' : 'none'
                }}
                aria-hidden={!targetReached}
              >
                <span>Next 🎲</span>
              </button>
              <button
                type="button"
                className="numbers-btn-secondary reset-start-btn"
                onClick={() => hopToPosition(0)}
                disabled={!hasRolled || bunnyPos === 0}
                title="Back to Start"
              >
                <span>↺ Start</span>
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* ============================================================ */}
      {/* MODAL: HOW TO PLAY TUTORIAL                                  */}
      {/* ============================================================ */}
      {tutorialModalOpen && (
        <div className="numbers-modal-overlay">
          <div className="numbers-modal-card">
            <button
              type="button"
              className="numbers-modal-close"
              onClick={() => setTutorialModalOpen(false)}
              title="Close"
            >
              ✕
            </button>
            <h2 style={{ fontFamily: 'var(--font-display, Georgia, serif)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--clr-text)', margin: '0 0 6px 0' }}>
              How to Play 🐰
            </h2>
            <p style={{ fontSize: '0.92rem', color: 'var(--clr-text-soft)', marginBottom: '16px' }}>
              Roll the die and hop with Bunny to find the number!
            </p>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              textAlign: 'left',
              marginBottom: '20px',
              background: 'var(--clr-surface)',
              padding: '14px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--clr-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.92rem' }}>
                <span style={{ fontSize: '1.4rem' }}>🎲</span>
                <span><strong>1. Roll</strong> the die to see where to hop!</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.92rem' }}>
                <span style={{ fontSize: '1.4rem' }}>🐰</span>
                <span><strong>2. Tap Hop ▶</strong> to step across cards!</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.92rem' }}>
                <span style={{ fontSize: '1.4rem' }}>⭐</span>
                <span><strong>3. Land</strong> on the glowing card to reveal it!</span>
              </div>
            </div>

            <button
              type="button"
              className="numbers-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setTutorialModalOpen(false)}
            >
              Let's Play! 🚀
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: STAR REWARD DIALOG                                    */}
      {/* ============================================================ */}
      {rewardModal.open && (
        <div className="numbers-modal-overlay">
          <div className="numbers-modal-card">
            <div style={{ fontSize: '3.5rem', marginBottom: '6px' }}>
              {rewardModal.emoji}
            </div>
            <h3 style={{ fontFamily: 'var(--font-display, Georgia, serif)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--clr-text)', margin: '0 0 4px 0' }}>
              {rewardModal.title}
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--clr-text-soft)', marginBottom: '16px' }}>
              {rewardModal.subtitle}
            </p>
            <div style={{ fontSize: '1.6rem', marginBottom: '20px' }}>
              ⭐ ⭐ ⭐
            </div>
            <button
              type="button"
              className="numbers-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setRewardModal(prev => ({ ...prev, open: false }))}
            >
              Keep Going! 🚀
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
