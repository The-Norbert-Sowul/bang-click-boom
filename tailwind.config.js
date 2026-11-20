/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bcb: {
          canvas: "#1A1312",
          coffee: "#291F1E",
          surface: "#342726",
          border: "#463634",
          cerulean: "#477998",
          "cerulean-light": "#5C92B4",
          tea: "#C4D6B0",
          "tea-dark": "#9AB380",
        },
      },
    },
  },
  plugins: [],
};
