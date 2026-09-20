import assert from 'node:assert/strict';
import test from 'node:test';
import { ModalBackdrop } from '../web/src/components/ModalBackdrop.tsx';

test('modal backdrop closes only when the backdrop itself is clicked', () => {
  let closeCount = 0;
  const element = ModalBackdrop({
    children: null,
    className: 'test-modal-backdrop',
    onClose: () => { closeCount += 1; },
  });
  const backdrop = {};
  const click = element.props.onClick;
  assert.ok(click);

  click({ target: {}, currentTarget: backdrop } as never);
  assert.equal(closeCount, 0, 'clicking modal content must keep the modal open');

  click({ target: backdrop, currentTarget: backdrop } as never);
  assert.equal(closeCount, 1, 'clicking the backdrop must close the modal');
});
