/** Scale typography at build time, including Tailwind's arbitrary pixel sizes.
 * Keep rem layout dimensions stable. Relative em/% fonts and unitless line heights
 * already inherit the enlarged font and must not receive a second multiplier.
 */
export default function textScale() {
  return {
    postcssPlugin: 'orbit-text-scale',
    OnceExit(root) {
      root.walkDecls(/^(font-size|line-height)$/, (declaration) => {
        const value = declaration.value
        if (value.includes('--orbit-text-scale')) return
        if (!/\d(?:px|rem|vw|vh|vmin|vmax)\b/.test(value)) return
        declaration.value = `calc((${value}) * var(--orbit-text-scale, 1))`
      })
    }
  }
}
