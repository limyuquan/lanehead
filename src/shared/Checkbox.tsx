import { type InputHTMLAttributes, useState } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  checked: boolean;
  /** Saves the new value; `checked` should reflect it once this resolves. */
  onChange: (on: boolean) => Promise<unknown>;
};

/** A checkbox for a stored value: shows the click at once instead of flicking back while saving. */
export function Checkbox({ checked, onChange, ...rest }: Props) {
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <input
      {...rest}
      type="checkbox"
      checked={pending ?? checked}
      onChange={(e) => {
        const on = e.currentTarget.checked;
        setPending(on);
        void onChange(on).finally(() => setPending(null));
      }}
    />
  );
}
