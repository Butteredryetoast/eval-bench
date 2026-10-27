import { WORKSPACE_LINKS } from "./web/navigation.ts";
import { defineWebModule } from "@aihot/web/modules";
export default defineWebModule({
  name: "hot-monitor",
  admin: {
    landing: "/admin/monitor",
    groups: [
      {
        group: "猿大侠编辑工作区",
        items: WORKSPACE_LINKS.map(({to,label})=>({to,label})),
      },
    ],
  },
});
