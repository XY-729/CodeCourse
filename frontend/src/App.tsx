import useAppController from "./app/useAppController";
import AppView from "./app/views/AppView";

export { pickDefaultCourse, resetGenerationScope } from "./app/appUtils";

export default function App() {
  const model = useAppController();
  return <AppView model={model} />;
}
