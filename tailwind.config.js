/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // OverBuild Labs brand — emerald primary (CTAs, links, active nav,
        // primary headings). Matches the website's brand.primary #10b981.
        primary: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        // Secondary brand accent — violet (secondary CTAs, accent icons).
        // Matches the website's brand.accent #8b5cf6. Available for use; not
        // yet applied wholesale (see SESSION notes / before-after).
        accent: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        // Brand dark surfaces — neutral grey on near-black, matching the
        // website. Green lives only in the emerald primary (logo, buttons,
        // active nav), NOT the surfaces.
        dark: {
          700: '#202028',  // hover lift (lighter grey)
          800: '#16161B',  // card / panel background (dark grey)
          850: '#121216',  // subtle section surface (between card and page)
          900: '#0C0C0F',  // page background (near-black)
          950: '#060608',  // deepest surface
        },
      },
    },
  },
  plugins: [],
}
