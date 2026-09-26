export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Result 类型定义（作为 Type 使用）
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * 基础工厂与高阶工具函数
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

/**
 * 伴随对象（作为 Value 使用，支持 Result.ok() / Result.isOk() / Result.map()）
 */
export const Result = {
  ok,
  err,
  isOk,
  isErr,
  map,
  flatMap,
} as const;
