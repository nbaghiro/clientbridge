// The slice of each app's createApi() that the shared mutations need (web + mobile build their own).
export interface ApiLike {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
}
