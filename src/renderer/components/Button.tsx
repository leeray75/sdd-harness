import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

/** primary: one per view. gate: human-only decisions. secondary: the default. ghost: low weight. danger: destructive text. */
export type ButtonVariant = 'primary' | 'gate' | 'secondary' | 'ghost' | 'danger';

/** default is 40px tall; small is 32px. */
export type ButtonSize = 'default' | 'small';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A real button. It is `type="button"` unless a `type` is passed, so it never submits a form by accident. */
export function Button({
  variant = 'secondary',
  size = 'default',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = ['button', `button--${variant}`, `button--${size}`, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}
