export type ContractSearchSummaryMode = 'ship' | 'jumpCapable';

export type ContractSearchSummaryInput = {
  mode: ContractSearchSummaryMode;
  resultCount: number;
  originName: string;
  radius: number;
  fetchedAt: number;
};

export function formatContractSearchSummaryLine(input: ContractSearchSummaryInput): string {
  if (input.mode !== 'jumpCapable') {
    return '';
  }

  const shipLabel = input.resultCount === 1 ? 'ship' : 'ships';
  const jumpLabel = input.radius === 1 ? 'jump' : 'jumps';
  return `${input.resultCount.toLocaleString()} jump-capable ${shipLabel} within ${input.radius} cyno ${jumpLabel} of ${input.originName}. Updated ${formatEveDateTime(input.fetchedAt)}`;
}

export function formatEveDateTime(value: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));

  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${getPart('hour')}:${getPart('minute')} eve time ${getPart('month')} ${getPart('day')}`;
}

