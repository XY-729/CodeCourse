import { BookOpen, Bot, FolderTree, UserRound } from "lucide-react";

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
      <button
        type="button"
        className={active === "learn" ? "active" : ""}
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
