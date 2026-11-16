/** SDK 抛出的所有错误基类。 */
export class XlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlpError';
  }
}

/** 平台 API 返回非 2xx 时抛出,message 为服务端错误原文。 */
export class XlpApiError extends XlpError {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'XlpApiError';
    this.status = status;
  }
}
