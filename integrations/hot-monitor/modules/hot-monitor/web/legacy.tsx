import { redirect, type LoaderFunctionArgs } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { API } from "./shared.tsx";
export async function loader({request,params}:LoaderFunctionArgs) {
  const result=await adminGet<{location:string}>(request,API+"/legacy/"+encodeURIComponent(params.kind??"")+"/"+encodeURIComponent(params.id??""));
  return redirect(result.location);
}
