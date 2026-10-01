type SkeletonProps = {
  width?: string
  height?: string
  radius?: string
  className?: string
}

// Placeholder block for loading states. Purely visual: the loading container
// carries the accessible status text.
function Skeleton({ width = '100%', height = '1rem', radius = '8px', className }: SkeletonProps) {
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  )
}

export default Skeleton
