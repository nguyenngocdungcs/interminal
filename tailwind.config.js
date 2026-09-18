/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/frontend/index.html",
    "./src/frontend/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        term: {
          bg: '#0f172a',
          surface: '#1e293b',
          border: '#334155',
          text: '#f8fafc',
          accent: '#38bdf8',
        }
      }
    },
  },
  plugins: [],
}
