import { useState } from "react";
import styles from "../AvatarCreator.module.css";

type Props = {
  nickname: string;
  setNickname: (nickname: string) => void;
  onNext: () => void;
};

// Identity step — collects the display username shown around the Virtual
// Office app. Kept distinct from UploadStep's optional "your name" field
// (that one only labels the mock-generation request); nickname is required
// before the employee can proceed to outfit/room selection.
export function NicknameStep({ nickname, setNickname, onNext }: Props) {
  const [touched, setTouched] = useState(false);
  const trimmed = nickname.trim();
  const showError = touched && trimmed.length === 0;

  return (
    <>
      <div className={styles.title}>What should we call you?</div>
      <div className={styles.subtitle}>Pick the nickname shown around the Virtual Office.</div>
      <input
        type="text"
        placeholder="Nickname"
        className={styles.nameInput}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      {showError && <div className={styles.subtitle}>Nickname is required.</div>}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={trimmed.length === 0}
          onClick={onNext}
        >
          Continue
        </button>
      </div>
    </>
  );
}

export default NicknameStep;
