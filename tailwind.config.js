/** @type {import('tailwindcss').Config} */
// QuizLock design tokens — clean SaaS look, "Mono Ink + Red" palette
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#edece6',
        card: '#ffffff',
        ink: '#131311',
        'ink-2': '#3a3833',
        muted: '#77726a',
        accent: '#e5322d',
        'accent-dark': '#c72620',
        line: '#e6e4dc',
        track: '#e9e7df',
        good: '#1f9d55',
        warn: '#c4791b',
        bad: '#e5322d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '16px' },
    },
  },
  plugins: [],
}
