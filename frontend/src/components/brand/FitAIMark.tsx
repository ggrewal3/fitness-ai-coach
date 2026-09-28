import type { SVGProps } from 'react'

// Finalized FitAI whale-orbit geometry. Do not edit — mirrors public/brand/*.svg.
const MASTER_PATH =
  'M4 4C46 14 96 38 119 84C131 55 186 40 242 11C220 100 150 114 135 128C126 137 136 200 198 199C256 198 406 62 494 65C556 65 598 100 597 140C598 210 406 275 318 277C226 277 121 278 106 190C100 160 94 136 84 124C72 107 8 90 4 4ZM613 136.8A336 81 -9 0 1 349.8 309.9L326.1 293.4A292 68 -9 0 0 611.7 152.1ZM96.2 214.6A336 81 -9 0 0 206.1 322.5C248.1 321.4 296 436 390 439C436 439 493 412 493 366C493 340 481 324 460 324C444 324 432 332 432 337C432 342 441 344 451 342C464 346 470 361 463 374C456 387 441 393 426 392C391 392 339.8 293 282 298.2A292 68 -9 0 1 100.7 224.8Z'

const SMALL_PATH =
  'M4 4C46 14 96 38 119 84C131 55 186 40 242 11C220 100 150 114 135 128C126 137 136 200 198 199C256 198 406 62 494 65C556 65 598 100 597 140C598 210 406 275 318 277C226 277 121 278 106 190C100 160 94 136 84 124C72 107 8 90 4 4ZM626.9 141.4A340 86 -9 0 1 477 296.3L350 300.1A290 68 -9 0 0 621.7 167.4ZM84.1 222.1A340 86 -9 0 0 206 333.1C248 332.3 296 436 390 439C436 439 493 412 493 366C493 340 481 324 460 324C444 324 432 329 432 337C432 345 441 347 451 345C464 346 470 361 463 374C456 387 441 393 426 392C391 392 339.7 303 281.9 308.2A290 68 -9 0 1 93.2 240.1Z'

const VIEW_WIDTH = 697
const VIEW_HEIGHT = 443
const SMALL_MAX_SIZE = 32

type FitAIMarkProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  /** Rendered width in pixels; height follows the mark's aspect ratio. */
  size?: number
  /** Accessible name. Omit when the mark sits beside visible brand text. */
  title?: string
}

function FitAIMark({ size = 32, title, ...props }: FitAIMarkProps) {
  const height = Math.round((size * VIEW_HEIGHT) / VIEW_WIDTH * 100) / 100
  const accessibility = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': true as const, focusable: 'false' as const }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width={size}
      height={height}
      fill="currentColor"
      preserveAspectRatio="xMidYMid meet"
      {...accessibility}
      {...props}
    >
      <path d={size <= SMALL_MAX_SIZE ? SMALL_PATH : MASTER_PATH} />
    </svg>
  )
}

export default FitAIMark
