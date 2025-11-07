import cv2
from imageStorage import ImageStorage


class ImageCapturer:

    def __init__(self):
        self.frame_count: int = 0
        self.cap: cv2.VideoCapture = cv2.VideoCapture(0)
        self.storage: ImageStorage = ImageStorage()

    def capture(self) -> bool:
        ret, frame = self.cap.read()
        if not ret:
            print(f"failed to capture frame {self.frame_count}")
            return False

        succeeded: bool = self.storage.store(frame, self.frame_count)
        if not succeeded:
            return False

        self.frame_count += 1

        return True

    def __del__(self):
        self.cap.release()


def main():
    capturer = ImageCapturer()
    print("Press Enter to capture an image, or 'q' then Enter to quit.")
    while True:
        cmd = input()
        if cmd.lower() == "q":
            break

        if not capturer.capture():
            print("Capture failed. Exiting")


if __name__ == "__main__":
    main()
