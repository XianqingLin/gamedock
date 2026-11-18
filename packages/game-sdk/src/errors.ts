/** SDK 抛出的所有错误基类。 */
export class GameDockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameDockError';
  }
}

/** 平台 API 返回非 2xx 时抛出,message 为服务端错误原文。 */
export class GameDockApiError extends GameDockError {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GameDockApiError';
    this.status = status;
  }
}
