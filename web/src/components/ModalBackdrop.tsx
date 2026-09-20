import type { ComponentPropsWithoutRef, MouseEvent } from 'react';

type Props = Omit<ComponentPropsWithoutRef<'div'>, 'onClick'> & {
  onClose: () => void;
};

export function ModalBackdrop({ onClose, ...props }: Props) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return <div {...props} onClick={handleClick} />;
}
