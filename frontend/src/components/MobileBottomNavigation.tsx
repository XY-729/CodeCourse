import { BookOpen, Bot, FolderTree, UserRound } from "lucide-react";
import SlidingSelectionIndicator from "./SlidingSelectionIndicator";

export type MobilePrimaryDestination = "learn" | "source" | "ask" | "me";

type Props = {
  active: MobilePrimaryDestination;
  onLearn: () => void;
  onSource: () => void;
  onAsk: () => void;
  onMe: () => void;
};

export default function MobileBottomNavigation({
  active,
  onLearn,
  onSource,
  onAsk,
  onMe,
}: Props) {
  return (
    <nav className="mobile-bottom-navigation" aria-label="主要导航">
      <SlidingSelectionIndicator activeKey={active} className="mobile-navigation-indicator" />
      <button
        type="button"
        className={active === "learn" ? "active" : ""}
        data-selection-key="learn"
        aria-current={active === "learn" ? "page" : undefined}
        onClick={onLearn}
      >
        <span className="mobile-bottom-navigation-icon">
          <BookOpen size={21} />
        </span>
        <span>学习</span>
      </button>

      <button
        type="button"
        className={active === "source" ? "active" : ""}
        data-selection-key="source"
        aria-current={active === "source" ? "page" : undefined}
        onClick={onSource}
      >
        <span className="mobile-bottom-navigation-icon">
          <FolderTree size={21} />
        </span>
        <span>源码</span>
      </button>

      <button
        type="button"
        className={active === "ask" ? "active" : ""}
        data-selection-key="ask"
        aria-current={active === "ask" ? "page" : undefined}
        onClick={onAsk}
      >
        <span className="mobile-bottom-navigation-icon">
          <Bot size={21} />
        </span>
        <span>提问</span>
      </button>

      <button
        type="button"
        className={active === "me" ? "active" : ""}
        data-selection-key="me"
        aria-current={active === "me" ? "page" : undefined}
        onClick={onMe}
      >
        <span className="mobile-bottom-navigation-icon">
          <UserRound size={21} />
        </span>
        <span>我的</span>
      </button>
    </nav>
  );
}
