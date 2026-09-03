/** @type {import('tailwindcss').Config} */
// QuizLock design tokens — "Mono Ink + Red" (Editorial Bold)
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f2f1ec',
        ink: '#131311',
        accent: '#e5322d',
        'accent-dark': '#c72620',
        muted: '#757064',
        rule: '#dddbd1',
        'rule-strong': '#131311',
        good: '#1f9d55',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
