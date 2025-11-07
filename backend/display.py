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
        self._text: str = ""
        self._currentImage: cv2.typing.MatLike | None = None

    def showSlideShow(self, images: list[cv2.typing.MatLike]):
        # images: list[cv2.typing.MatLike] = self.storage.retrieveAll()

        TOTAL_DURATION_S: float = showDuration(len(images))
        SLIDE_DURATION_MS: int = int(TOTAL_DURATION_S / len(images) * 1000)
        for im in images:
            assert im is not None

            self.showSnap(im)

            if cv2.waitKey(SLIDE_DURATION_MS) & 0xFF == ord("q"):
                break
        print(f"Finished slideshow of {len(images)} slides in {TOTAL_DURATION_S}s")

    def showSnap(self, img: cv2.typing.MatLike):
        self._currentImage = img

        if self._text:
            self.print(self._text)

        cv2.imshow(self.WINDOW_NAME, img)

    def open(self):
        # Create a named window and set it to full screen
        cv2.namedWindow(self.WINDOW_NAME, cv2.WND_PROP_FULLSCREEN)
        # cv2.setWindowProperty(
        #     self.WINDOW_NAME, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN
        # )
        #

    def print(self, msg: str):
        self._text = msg
        org = (50, 150)  # Bottom-left corner of the text string
        font = cv2.FONT_HERSHEY_TRIPLEX  # Font type
        fontScale = 1.5  # Font scale factor
        color = (255, 110, 0)  # Text color in BGR format (red in this case)
        thickness = 2  # Thickness of the text strokes
        lineType = cv2.LINE_AA  # Line type for anti-aliased text

        if self._currentImage is None:
            return
        # Draw the text on the image
        _ = cv2.putText(
            self._currentImage,
            self._text,
            org,
            font,
            fontScale,
            color,
            thickness,
            lineType,
        )

    def clearText(self):
        print("")
        cv2.namedWindow("text", cv2.WND_PROP_AUTOSIZE)

    def close(self):
        cv2.destroyAllWindows()

    def __del__(self):
        self.close()


def main():
    storage: ImageStorage = ImageStorage()
    display: Display = Display()
    display.open()
    display.print("hello world")
    display.showSlideShow(storage.retrieveAll())


if __name__ == "__main__":
    main()
