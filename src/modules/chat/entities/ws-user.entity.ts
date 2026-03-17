export interface WsUser {
  id: string;
  role: 'Client' | 'Manager' | 'Admin';
}
