export const CONNECTION_PROVIDERS = ["dajiala", "socialdata"] as const;
export type ConnectionProvider = typeof CONNECTION_PROVIDERS[number];
export interface ConnectionStatus {
  provider: ConnectionProvider;
  name: string;
  /** Configuration availability, not a successful request, sufficient balance, or source activation. */
  enabled: boolean;
  hasKey: boolean;
  baseUrl: string;
  managedBy: "file" | "env" | "unsupported";
  editable: boolean;
  capabilities: string[];
  note?: string;
}
export interface ConnectionsData { connections: ConnectionStatus[] }
export interface SaveConnectionInput { key?: string; baseUrl?: string }
