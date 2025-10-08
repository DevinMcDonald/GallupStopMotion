import math

import cv2

from imageStorage import ImageStorage


def showDuration(n: int):
    min: float = 1
    max: float = 5
    k = 0.1  # You can adjust k to change the rate of approach to the limit
    return max - (max - min) * math.exp(-k * (n - 1))


class Display:
    WINDOW_NAME: str = "Stop Motion"

    def __init__(self):
        pass

    def showSlideShow(self, images: list[cv2.typing.MatLike]):
        # images: list[cv2.typing.MatLike] = self.storage.retrieveAll()

        TOTAL_DURATION_S: float = showDuration(len(images))
        SLIDE_DURATION_MS: int = int(TOTAL_DURATION_S / len(images) * 1000)
        for im in images:
            assert im is not None

            cv2.imshow(self.WINDOW_NAME, im)

            if cv2.waitKey(SLIDE_DURATION_MS) & 0xFF == ord("q"):
                break
        print(f"Finished slideshow of {len(images)} slides in {TOTAL_DURATION_S}s")

    def showSnap(self, img: cv2.typing.MatLike):
        cv2.imshow(self.WINDOW_NAME, img)

    def open(self):
        # Create a named window and set it to full screen
        cv2.namedWindow(self.WINDOW_NAME, cv2.WND_PROP_FULLSCREEN)
        cv2.setWindowProperty(
            self.WINDOW_NAME, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN
        )


def main():
    storage: ImageStorage = ImageStorage()
    display = Display()
    display.open()
    display.showSlideShow(storage.retrieveAll())


if __name__ == "__main__":
    main()
