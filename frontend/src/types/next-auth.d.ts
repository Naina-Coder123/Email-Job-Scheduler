import "next-auth";
import "next-auth/jwt";
import type { BackendUser } from "./index";

declare module "next-auth" {
  interface Session {
    backendToken?: string;
    backendUser?: BackendUser;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    backendToken?: string;
    backendUser?: BackendUser;
  }
}
