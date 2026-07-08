export const CONTRACT_RADIUS_DEFAULT = 30;
export const CONTRACT_RADIUS_MIN = 1;
export const CONTRACT_RADIUS_MAX = 100;

export type ContractType = 'item_exchange' | 'auction';

export interface ContractWarning {
  code: string;
  message: string;
  count?: number;
}

export interface ContractShipHit {
  id: number;
  name: string;
  groupName: string;
}

export interface PublicContractSummary {
  contract_id: number;
  issuer_id: number;
  issuer_corporation_id: number;
  type: string;
  date_issued: string;
  date_expired: string;
  title?: string;
  price?: number;
  buyout?: number;
  start_location_id?: number;
  end_location_id?: number;
}

export interface PublicContractItem {
  record_id: number;
  type_id: number;
  quantity: number;
  is_included: boolean;
}

export interface ContractRegion {
  id: number;
  name: string;
}

export interface ContractOrigin {
  id: number;
  name: string;
}

export interface ContractSearchResult {
  contractId: number;
  type: ContractType;
  title: string;
  price: number | null;
  buyout: number | null;
  effectivePrice: number | null;
  quantity: number;
  shipTypeId: number;
  shipName: string;
  regionId: number;
  regionName: string;
  systemId: number | null;
  systemName: string | null;
  locationName: string;
  locationKnown: boolean;
  jumps: number | null;
  dateIssued: string;
  dateExpired: string;
}

export interface ContractSearchResponse {
  ship: ContractShipHit;
  origin: ContractOrigin;
  radius: number;
  regionsScanned: ContractRegion[];
  index: ContractIndexSummary;
  fetchedAt: number;
  results: ContractSearchResult[];
  warnings: ContractWarning[];
}

export interface ContractIndexSummary {
  complete: boolean;
  regionsTotal: number;
  regionsReady: number;
  regionsStale: number;
  regionsMissing: number;
  regionsQueued: number;
  oldestRefreshedAt: number | null;
  newestRefreshedAt: number | null;
  activeContracts: number;
  indexedItemContracts: number;
}
