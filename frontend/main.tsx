import { Component, lazy, Suspense } from "react";
import { registerModule } from "@panasms/runtime";
import { mdiFileEyeOutline } from "@mdi/js";
import { asset, kind, type Props } from "./types";
import { t } from "./strings";
const Workspace = lazy(() => import(asset + "workspace.js"));
class Boundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">{t("error")}</p>
    ) : (
      this.props.children
    );
  }
}
function FileViewer(p: Props) {
  return (
    <Boundary>
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <Workspace {...p} />
      </Suspense>
    </Boundary>
  );
}
const module = {
  id: "viewers",
  title: t("title"),
  icon: mdiFileEyeOutline,
  memberAccess: true,
  fileViewer: {
    accepts: (name: string) => !!kind(name),
    component: FileViewer,
  },
};
registerModule(module);
