# Tenali Extracted Apps Directory

This directory contains standalone app and game components extracted from the monolithic `App.jsx` file, as part of the modularization epic (issues #235, #236, #239).

## Conventions
- **Exports:** Each file exports its component both as named export and default export (e.g. `export { MultiplyApp }`, `export default MultiplyApp`).
- **Shared Hooks & Layouts:**
  - Layout: `import { QuizLayout } from '../components/QuizLayout'`
  - Timer: `import { useTimer } from '../hooks/useTimer'`
  - Key Terms: `import KeyTerms from '../components/KeyTerms'`
  - Core Shared Helpers: `import { useAutoAdvance, getSpeedRunLimit, NumPad, ResultsTable, renderFeedback } from '../App'`
