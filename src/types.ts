export type Primitive = 'birth' | 'think' | 'act';
export type Visibility = 'private' | 'public';

export interface MemoryEvent {
  id: string;             // app-level event id (NIP-AE slug segment)
  agentId: string;
  primitive: Primitive;
  visibility: Visibility;
  text: string;
  tool?: string;
  params?: string;
  createdAt: string;
}

export interface AgentState {
  agentId: string;
  name: string;
  memoryRoot: string;
  createdAt: string;
}
