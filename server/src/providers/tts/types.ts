export interface TTSRequest {
  text: string;
  stability: number;
  style: number;
  speed: number;
}

export interface TTSResponse {
  audioContent: string; // base64-encoded audio
}

export interface TTSProvider {
  name: string;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  healthCheck(): Promise<boolean>;
}
