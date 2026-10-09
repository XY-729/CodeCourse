import type useAppController from "../useAppController";

/** Shared application state/actions; views select only the fields they render. */
export type AppViewModel = ReturnType<typeof useAppController>;
