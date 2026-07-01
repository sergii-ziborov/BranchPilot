export interface BranchBaseOption {
  value: string
  label: string
  kind: string
}

export function uniqueBranchBaseOptions(options: BranchBaseOption[]): BranchBaseOption[] {
  const seen = new Set<string>()
  const uniqueOptions: BranchBaseOption[] = []

  for (const option of options) {
    const value = option.value.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    uniqueOptions.push({ ...option, value })
  }

  return uniqueOptions
}
