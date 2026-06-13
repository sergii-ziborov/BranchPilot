export type ConfirmationVariant = 'default' | 'danger'

export interface ConfirmationOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmationVariant
}

export interface TextPromptOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  defaultValue?: string
  placeholder?: string
}

export type RequestConfirmation = (message: string, options?: ConfirmationOptions) => Promise<boolean>
export type RequestTextInput = (message: string, options?: TextPromptOptions) => Promise<string | null>
