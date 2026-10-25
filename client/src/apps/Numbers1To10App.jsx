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

  // Currently revealed pad for this round (revealed ONLY when reaching the right card!)
  const [revealedPad, setRevealedPad] = useState(null);
  const [discoveredNumbers, setDiscoveredNumbers] = useState(new Set());

  // Round message & lock
  const [feedbackMsg, setFeedbackMsg] = useState('Tap "Roll Dice! 🎲" to see how many hops Bunny needs!');
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

  // Roll die with random count from 1 to 10
  const rollGameDice = useCallback(() => {
    if (autoRollTimerRef.current) clearTimeout(autoRollTimerRef.current);
    sfxDiceRoll();
    setGameDiceRolling(true);
    setTargetReached(false);
    setRevealedPad(null); // Cards reset to blank for the new roll!
    setBunnyPos(0); // Reset bunny to start burrow above cards
    setBunnyYayVisible(false);

    setTimeout(() => {
      let next = Math.floor(Math.random() * 10) + 1;
      setGameDiceTarget(next);
      setHasRolled(true);
      setGameDiceRolling(false);
      setFeedbackMsg(`Count the ${next} dots on the die! Use arrow keys to hop ${next} steps!`);
    }, 280);
  }, [sfxDiceRoll]);

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
      setFeedbackMsg(`🎉 Fantastic! You reached the right card: ${target} (${NUMBER_WORDS[target]})!`);

      // Auto roll next round after celebration
      if (autoRollTimerRef.current) clearTimeout(autoRollTimerRef.current);
      autoRollTimerRef.current = setTimeout(() => {
        rollGameDice();
      }, 3200);
    } else if (newPos > target) {
      sfxBoing();
      setFeedbackMsg(`Oops! You hopped past ${target}! Use ◀ Hop Left to step back to the glowing card.`);
    } else {
      setFeedbackMsg(`Good hop! ${target - newPos} more step${target - newPos > 1 ? 's' : ''} to reach ${target}!`);
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
      setFeedbackMsg('🎲 Tap "Roll Dice!" first to see how many hops Bunny needs!');
      sfxBoing();
      return;
    }
    if (bunnyPos >= 10 || gameDiceRolling) return;
    hopToPosition(bunnyPos + 1);
  }, [hasRolled, bunnyPos, gameDiceRolling, hopToPosition, sfxBoing]);

  // Arrow control: Hop Left (backward)
  const hopLeft = useCallback(() => {
    if (!hasRolled) {
      setFeedbackMsg('🎲 Tap "Roll Dice!" first to see how many hops Bunny needs!');
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

  // Dice Pip Face Component (1 to 10 dots only - NO numerals printed on die!)
  const DiceFace = ({ count }) => {
    const pipBg = '#111827';

    if (!hasRolled || count <= 0) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '2px',
          userSelect: 'none'
        }}>
          <span style={{ fontSize: '2.2rem' }}>🎲</span>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#111827', textTransform: 'uppercase' }}>
            Roll Me!
          </span>
        </div>
      );
    }

    if (count <= 6) {
      const pipMap = {
        1: [4],
        2: [0, 8],
        3: [0, 4, 8],
        4: [0, 2, 6, 8],
        5: [0, 2, 4, 6, 8],
        6: [0, 2, 3, 5, 6, 8]
      };
      const pips = pipMap[count] || [];

      return (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          width: '100%',
          height: '100%',
          padding: '4px',
          gap: '4px',
          placeItems: 'center'
        }}>
          {Array.from({ length: 9 }).map((_, idx) => (
            <div
              key={idx}
              style={{
                width: '15px',
                height: '15px',
                borderRadius: '50%',
                background: pips.includes(idx) ? pipBg : 'transparent',
                boxShadow: pips.includes(idx) ? 'inset 0 2px 3px rgba(0,0,0,0.45)' : 'none'
              }}
            />
          ))}
        </div>
      );
    } else {
      const col1 = Math.ceil(count / 2);
      const col2 = Math.floor(count / 2);
      const dotSize = count > 8 ? '11px' : '13px';

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
          width: '100%',
          height: '100%',
          padding: '2px 0'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', height: '100%' }}>
            {Array.from({ length: col1 }).map((_, i) => (
              <div
                key={`c1-${i}`}
                style={{
                  width: dotSize,
                  height: dotSize,
                  background: pipBg,
                  borderRadius: '50%',
                  boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.45)'
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', height: '100%' }}>
            {Array.from({ length: col2 }).map((_, j) => (
              <div
                key={`c2-${j}`}
                style={{
                  width: dotSize,
                  height: dotSize,
                  background: pipBg,
                  borderRadius: '50%',
                  boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.45)'
                }}
              />
            ))}
          </div>
        </div>
      );
    }
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
            <h2>Tenali · Number Foundations</h2>
            <span className="numbers-header-subtitle">Hopscotch Numbers (1 to 10)</span>
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
            <span className="numbers-status-pill" style={{ fontSize: '0.76rem' }}>
              🐰 Hopscotch Game
            </span>
            <h1 style={{ margin: 0, fontSize: 'clamp(1.15rem, 2vw, 1.4rem)' }}>
              Hopscotch Mat Adventure
            </h1>
          </div>

          <button
            type="button"
            className="numbers-btn-secondary"
            style={{ fontSize: '0.78rem', padding: '4px 12px' }}
            onClick={() => setTutorialModalOpen(true)}
          >
            <span>👀 How to Play</span>
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
                className={`dice-cube compact ${gameDiceRolling ? 'rolling' : ''}`}
                onClick={rollGameDice}
                title="Tap die to roll"
              >
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DiceFace count={gameDiceTarget} />
                </div>
              </div>

              <button
                type="button"
                className="numbers-btn-primary compact"
                onClick={rollGameDice}
                disabled={gameDiceRolling}
              >
                <span>🎲</span> <span>{hasRolled ? 'Roll Again' : 'Roll Dice!'}</span>
              </button>

              <p className="arena-feedback-msg" title={feedbackMsg}>
                {feedbackMsg}
              </p>
            </div>

            <div className="numbers-status-pill compact arena-goal-pill">
              <span>{hasRolled ? `🎯 Target: ${gameDiceTarget} Dots` : '🎲 Ready to Roll'}</span>
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
                  HOP! ⭐ {NUMBER_WORDS[gameDiceTarget]}!
                </div>
              )}
              <span className="bunny-emoji">🐰</span>
            </div>

            {/* Row 1: Start Position (Burrow above Card 1) + Route Guide */}
            <div className="track-top-row">
              {/* Column 1: Start Burrow directly above Card 1 */}
              <div
                className={`start-burrow-above ${bunnyPos === 0 ? 'is-active-spot' : ''}`}
              >
                <span className="start-burrow-badge">🌱 START (0)</span>
                <span className="start-burrow-icon" style={{ opacity: bunnyPos === 0 ? 0.35 : 1 }}>🥕</span>
                <span className="start-burrow-sub">
                  {bunnyPos === 0 ? 'Resting' : 'Burrow'}
                </span>
              </div>

              {/* Columns 2-10: Route Info Banner */}
              <div className="track-guide-banner">
                <div className="track-guide-text">
                  {!hasRolled ? (
                    <span>🎲 Bunny is at Start! Tap <strong>"Roll Dice!"</strong> to see how many hops to take!</span>
                  ) : bunnyPos === 0 ? (
                    <span>✨ The first <strong>{gameDiceTarget}</strong> cards are glowing! Use arrow buttons or keys to hop! ⬇️</span>
                  ) : targetReached ? (
                    <span>🎉 <strong>Target reached!</strong> Card {gameDiceTarget} revealed: <strong>{NUMBER_WORDS[gameDiceTarget]}</strong>! ⭐</span>
                  ) : bunnyPos < gameDiceTarget ? (
                    <span>✨ Keep hopping with arrows! <strong>{gameDiceTarget - bunnyPos}</strong> more hop{gameDiceTarget - bunnyPos > 1 ? 's' : ''} to reach the right card!</span>
                  ) : (
                    <span>⚠️ Hopped past {gameDiceTarget}! Tap <strong>◀ Hop Left</strong> to step back.</span>
                  )}
                </div>
                <div className="track-target-pill">
                  <span>{hasRolled ? `🎯 Goal: Card ${gameDiceTarget}` : '🎲 Roll to Begin'}</span>
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
                title="Hop backward (Left Arrow)"
              >
                <span>◀</span> <span>Hop Left</span>
              </button>

              <button
                type="button"
                className="hop-arrow-btn primary"
                onClick={hopRight}
                disabled={!hasRolled || bunnyPos >= 10 || gameDiceRolling}
                title="Hop forward (Right Arrow)"
              >
                <span>Hop Right</span> <span>▶</span>
              </button>
            </div>

            <div className="hop-step-indicator">
              <span>🐰 Step: <strong>{bunnyPos === 0 ? 'Start (0)' : bunnyPos}</strong></span>
              <span>/</span>
              <span>Target: <strong>{hasRolled ? `${gameDiceTarget} (${NUMBER_WORDS[gameDiceTarget]})` : 'Roll die first'}</strong></span>
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
                <span>🎲 Next Roll</span>
              </button>
              <button
                type="button"
                className="numbers-btn-secondary reset-start-btn"
                onClick={() => hopToPosition(0)}
                disabled={!hasRolled || bunnyPos === 0}
                title="Reset Bunny to Start Burrow"
              >
                Reset to Start (0)
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
              How to Play Hopscotch Mat
            </h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--clr-text-soft)', marginBottom: '16px' }}>
              Count the dots on the die, then use the arrow buttons to help Bunny hop across the glowing cards to reach the matching number!
            </p>

            <div style={{
              background: 'var(--clr-surface)',
              border: '1px solid var(--clr-border)',
              borderRadius: 'var(--radius)',
              padding: '16px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-around'
            }}>
              <div style={{
                width: '54px',
                height: '54px',
                background: '#fff',
                border: '2px solid #111',
                borderRadius: '12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                padding: '6px',
                placeItems: 'center'
              }}>
                <div style={{ width: '8px', height: '8px', background: '#111', borderRadius: '50%' }} /><div /><div />
                <div /><div style={{ width: '8px', height: '8px', background: '#111', borderRadius: '50%' }} /><div />
                <div /><div /><div style={{ width: '8px', height: '8px', background: '#111', borderRadius: '50%' }} />
              </div>
              <span style={{ fontSize: '1.6rem', color: 'var(--clr-accent)' }}>➔</span>
              <div style={{
                width: '50px',
                height: '60px',
                background: 'var(--clr-input)',
                border: '2px solid var(--clr-accent)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontFamily: 'var(--font-display, Georgia, serif)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--clr-accent)' }}>
                  3
                </span>
                <span style={{ fontSize: '0.7rem' }}>⭐</span>
              </div>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--clr-text-soft)', marginBottom: '16px', textAlign: 'left', lineHeight: 1.5 }}>
              💡 <strong>Tips:</strong><br />
              1. Bunny starts outside at <strong>🌱 START</strong>.<br />
              2. As you tap <strong>Hop Right ▶</strong>, cards stop glowing as Bunny steps on them.<br />
              3. When Bunny reaches the matching card, it flips to reveal the number and speaks the number name out loud!
            </p>

            <button
              type="button"
              className="numbers-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setTutorialModalOpen(false)}
            >
              👍 Let's Hop!
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
