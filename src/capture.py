import os

import cv2


class ImageCapturer:
    TEMP_DIR: str = "/tmp"
    IMAGE_DIR: str = f"{TEMP_DIR}/gallupStopMotion"

    def __init__(self):
        if not os.path.isdir(self.IMAGE_DIR):
            try:
                print(f"Creating {self.IMAGE_DIR}")
                os.mkdir(self.IMAGE_DIR)
            except Exception as _:
                print(f"Failed to create {self.IMAGE_DIR}")

    def capture(self):
        print("Press Enter to capture an image, or 'q' then Enter to quit.")
        frame_count: int = 0
        cap = cv2.VideoCapture(0)
        while True:
            cmd = input()
            if cmd.lower() == "q":
                break

            ret, frame = cap.read()
            if ret:
                filename = f"{self.IMAGE_DIR}/frame_{frame_count:03d}.png"
                succeeded: bool = cv2.imwrite(filename, frame)
                if not succeeded:
                    print(f"failed to save {filename}")
                else:
                    print(f"Saved {filename}")
                frame_count += 1

        cap.release()
