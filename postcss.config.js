import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import textScale from './scripts/postcss-text-scale.mjs'

export default {
  plugins: [tailwindcss(), autoprefixer(), textScale()]
}
