// Only fixed descriptions may reach a UI. Provider messages may echo prompts,
// reasoning, credentials or entire request bodies; redaction alone is not enough.
const statusReasons = {
    400: '请求参数被服务拒绝', 401: '服务授权失败', 403: '服务拒绝访问',
    404: '模型或服务接口不可用', 408: '服务请求超时', 413: '请求内容过长',
    422: '请求参数未通过服务校验', 429: '服务额度不足或请求过于频繁',
    500: '服务内部错误', 502: '上游服务响应异常', 503: '服务暂时不可用', 504: '上游服务响应超时',
};
const httpStatus = value => ['number', 'string'].includes(typeof value) && /^\d{3}$/.test(String(value))
    && Number(value) >= 400 && Number(value) <= 599 ? Number(value) : null;

/** Classify a short reason without returning any provider-authored free text. */
export function safeRequestReason(error, transportStatus) {
    if (error instanceof ProviderRequestError) return error.reason;
    const detail = error?.error && typeof error.error === 'object' ? error.error : error;
    const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message
        : typeof error?.error === 'string' ? error.error : '';
    const text = `${typeof detail?.code === 'string' ? detail.code : ''} ${message}`.slice(0, 8192);
    const status = [detail?.status, detail?.statusCode, error?.status, error?.response?.status, transportStatus,
        /\b(?:HTTP|status)\s*[:=]?\s*([45]\d{2})\b/i.exec(text)?.[1]].map(httpStatus).find(Boolean);
    let reason = '';
    if (/context_length_exceeded|maximum context|too many tokens|prompt (?:is )?too long/i.test(text)) reason = '请求超出模型上下文限制';
    else if (/response_format|json_schema|structured outputs?/i.test(text)) reason = '结构化输出参数被服务拒绝';
    else if (/unsupported_parameter|unsupported parameter|unrecognized request argument/i.test(text)) reason = '服务不支持请求中的参数';
    else if (/invalid_api_key|invalid api key|unauthorized|authentication/i.test(text)) reason = '服务授权失败';
    else if (/insufficient_quota|rate.limit|quota exceeded/i.test(text)) reason = statusReasons[429];
    else if (/bad request/i.test(text)) reason = '请求参数被服务拒绝（Bad Request）';
    else if (/timed? ?out|timeout/i.test(text) || error?.name === 'TimeoutError') reason = '服务请求超时';
    else if (/failed to fetch|network error|ECONNREFUSED|ENOTFOUND/i.test(text)) reason = '无法连接服务';
    return status ? `HTTP ${status}：${reason || statusReasons[status] || '服务请求失败'}` : reason;
}

/** Discard raw provider errors, including causes, before crossing UI boundaries. */
export class ProviderRequestError extends Error {
    constructor(error, status, prefix = '') {
        const reason = safeRequestReason(error, status) || '服务未返回可用的错误原因';
        super(prefix ? `${prefix} ${reason}` : reason);
        this.name = 'ProviderRequestError';
        this.reason = reason;
    }
}

const localMessages = new Set(['正在生成，请稍后重试。', '请先打开聊天。', '命运牌保存失败，请重试。']);

export function publicFailureMessage(error, fallback) {
    if (error instanceof ProviderRequestError) return error.message;
    if (localMessages.has(error?.message)) return error.message;
    const reason = safeRequestReason(error);
    return reason ? `${fallback} ${reason}` : fallback;
}
