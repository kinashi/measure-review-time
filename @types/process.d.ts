declare namespace NodeJS {
  interface ProcessEnv {
    readonly PERSONAL_ACCESS_TOKEN: string
    readonly OWNER: string
    readonly REPO: string
    readonly RANGE_OF_DATE: string
  }
}
