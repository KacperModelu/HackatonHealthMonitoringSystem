// Psychological questionnaire and cognitive test definitions.
// Shared by the React screens and the server (which recomputes the score).

// Every question is worth up to 10 points. Sliders go 0–10; "reverse" means
// a high value is bad (10 - value points).
export const PSYCH_QUESTIONS = [
  { text: 'How stressed do you feel?', slider: true, reverse: true, low: 'Not stressed', high: 'Extremely stressed' },
  { text: 'How lonely do you feel?', slider: true, reverse: true, low: 'Not lonely', high: 'Extremely lonely' },
  { text: 'How tired are you?', slider: true, reverse: true, low: 'Not tired', high: 'Extremely tired' },
  { text: 'How well are you sleeping?', slider: true, low: 'Very poorly', high: 'Very well' },
  {
    text: 'How many hours have you been sleeping recently per day?',
    options: ['0-3', '3-5', '6-8', '8-10', '10-12', '12+'],
    points: [0, 3, 10, 8, 5, 2],
  },
  { text: 'How well are you coping with workload?', slider: true, low: 'Not coping', high: 'Coping very well' },
  {
    text: 'What is your current mood?',
    options: ['Calm', 'Happy', 'Anxious', 'Sad', 'Irritated', 'Scared', 'Depressed'],
    points: [9, 10, 4, 3, 4, 2, 1],
  },
  {
    text: 'How connected are you to your crewmates?',
    options: ['Very connected', 'Somewhat connected', 'Neutral', 'Disconnected'],
    points: [10, 7, 5, 2],
  },
  {
    text: 'Which self-regulating practice have you been implementing?',
    options: ['Breathing exercises', 'Meditation', 'Yoga', 'Journaling', 'Other', 'None'],
    points: [9, 9, 9, 9, 7, 3],
  },
  {
    text: 'Which spaceflight stressor are you experiencing?',
    options: ['Isolation', 'Lack of clear day-night distinction', 'Insomnia', 'Exhaustion', 'Other', 'None of the above'],
    points: [3, 3, 1, 2, 4, 10],
  },
];

// Below this percentage the person is advised to contact support and offered activities.
export const PSYCH_THRESHOLD = 60;

// The maximum is the best total that can really be reached: 10 for a slider, the
// highest-scoring option for a choice question (99 in total, because no answer to the
// "self-regulating practice" question gives 10). So the best answers give 100%.
export const PSYCH_MAX = PSYCH_QUESTIONS.reduce(
  (sum, q) => sum + (q.slider ? 10 : Math.max(...q.points)), 0);

// The single place where the questionnaire is scored: the server calls it before
// saving, so the stored score never depends on what the browser claims.
// answers[i] is the slider value (0–10) or the option index.
// Returns { items: [{question, answer, points}], score, max, percent } or { error }.
export function scorePsych(answers) {
  if (!Array.isArray(answers) || answers.length !== PSYCH_QUESTIONS.length) {
    return { error: `Expected ${PSYCH_QUESTIONS.length} answers.` };
  }
  const items = [];
  for (const [i, q] of PSYCH_QUESTIONS.entries()) {
    const a = answers[i];
    if (q.slider) {
      if (!Number.isInteger(a) || a < 0 || a > 10) return { error: `Question ${i + 1}: value 0–10 expected.` };
      items.push({ question: q.text, answer: String(a), points: q.reverse ? 10 - a : a });
    } else {
      if (!Number.isInteger(a) || a < 0 || a >= q.options.length) return { error: `Question ${i + 1}: choose an answer.` };
      items.push({ question: q.text, answer: q.options[a], points: q.points[a] });
    }
  }
  const score = items.reduce((s, x) => s + x.points, 0);
  const max = PSYCH_MAX;
  return { items, score, max, percent: Math.round((1000 * score) / max) / 10 };
}

// --- cognitive tests ---------------------------------------------------------------
// `code` is what is stored in cognitive_result.test, `max` the highest possible score
// (the server rejects anything above it), `intro` the instructions shown before the start.
export const COGNITIVE_TESTS = [
  { code: 'reaction', name: 'Reaction Time', label: 'Reaction Time (5 trials)', max: 5,
    intro: 'Five successful trials. Wait until CLICK NOW appears, then click as quickly as possible. Early clicks must be retried.' },
  { code: 'memory', name: 'Digit Memory', label: 'Digit Memory (5 rounds)', max: 5,
    intro: 'Remember the digits shown briefly, then type them in order. Five rounds, from 3 to 7 digits.' },
  { code: 'two_back', name: '2-Back Working Memory', label: '2-Back Working Memory (12 digits)', max: 10,
    intro: 'You will see 12 digits, one at a time. For digits 3–12, answer whether the current digit matches the digit TWO places earlier.' },
  { code: 'matrix', name: 'Matrix Reasoning', label: 'Matrix Reasoning (5 questions)', max: 5,
    intro: 'Choose the missing number in each of five matrices.' },
  { code: 'spatial', name: 'Spatial Orientation', label: 'Spatial Orientation (5 questions)', max: 5,
    intro: 'Follow the imagined turns and choose the final direction.' },
  { code: 'symbols', name: 'Digit-Symbol Matching', label: 'Digit-Symbol Matching (10 matches)', max: 10,
    intro: 'Use keys 1–5 to match symbols. Answer 10 symbols as quickly and accurately as possible. Time limit: 60 seconds.' },
];

export const testByCode = (code) => COGNITIVE_TESTS.find((t) => t.code === code);

// Number matrices: every row follows the same rule (the third number is the sum of
// the first two, or each number is double the previous one). '?' is the missing
// bottom-right cell.
export const MATRIX_QUESTIONS = [
  { prompt: [[1, 2, 3], [2, 4, 6], [3, 6, '?']], options: ['7', '8', '9', '12'], correct: '9' },
  { prompt: [[2, 3, 5], [4, 5, 9], [6, 7, '?']], options: ['11', '12', '13', '14'], correct: '13' },
  { prompt: [[3, 6, 9], [4, 8, 12], [5, 10, '?']], options: ['12', '14', '15', '20'], correct: '15' },
  { prompt: [[1, 3, 4], [2, 5, 7], [4, 6, '?']], options: ['8', '9', '10', '12'], correct: '10' },
  { prompt: [[2, 4, 8], [3, 6, 12], [4, 8, '?']], options: ['12', '14', '16', '18'], correct: '16' },
];

const DIRECTIONS = ['North', 'East', 'South', 'West'];
export const SPATIAL_QUESTIONS = [
  { prompt: 'Face NORTH. Turn right, then left. Now facing?', options: DIRECTIONS, correct: 'North' },
  { prompt: 'Face EAST. Turn left, then left. Now facing?', options: DIRECTIONS, correct: 'West' },
  { prompt: 'Face SOUTH. Turn right, then right. Now facing?', options: DIRECTIONS, correct: 'North' },
  { prompt: 'Face WEST. Turn left, then right. Now facing?', options: DIRECTIONS, correct: 'West' },
  { prompt: 'Face NORTH. Turn right, right, then left. Now facing?', options: DIRECTIONS, correct: 'East' },
];

export const SYMBOLS = ['★', '●', '▲', '■', '◆'];   // digits 1–5
