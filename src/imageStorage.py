import glob
import os

import cv2


class ImageStorage:
    TEMP_DIR: str = "/tmp"
    IMAGE_DIR: str = f"{TEMP_DIR}/gallupStopMotion"

    def __init__(self):

        if not os.path.isdir(self.IMAGE_DIR):
            try:
                print(f"Creating {self.IMAGE_DIR}")
                os.mkdir(self.IMAGE_DIR)
            except Exception as _:
                print(f"Failed to create {self.IMAGE_DIR}")

    def fileNames(self) -> list[str]:
        frames: list[str] = sorted(glob.glob(f"{self.IMAGE_DIR}/frame_*.png"))
        return frames

    def getFrameFilepath(self, frameNumber: int) -> str:
        filename = f"{self.IMAGE_DIR}/frame_{frameNumber:05d}.png"
        return filename

    def store(self, img: cv2.typing.MatLike, frameNumber: int) -> bool:
        filename: str = self.getFrameFilepath(frameNumber)
        succeeded: bool = cv2.imwrite(filename, img)
        if not succeeded:
            print(f"failed to save {filename}")
            return False

        print(f"saved {filename}")
        return True

    def retrieve(self, frameNumber: int) -> cv2.typing.MatLike | None:
        filename: str = self.getFrameFilepath(frameNumber)
        img = cv2.imread(filename)
        if not img:
            return None
        return img

    def retrieveAll(self) -> list[cv2.typing.MatLike]:
        frames: list[str] = self.fileNames()
        images: list[cv2.typing.MatLike] = []
        for f in frames:
            img = cv2.imread(f)
            if img is not None:
                images.append(img)

        return images

    def retrieveLast(self) -> cv2.typing.MatLike:
        return self.retrieveAll()[-1]

    def clear(self):
        fileNames: list[str] = self.fileNames()
        for f in fileNames:
            os.remove(f)
        print(f"Deleted {len(fileNames)} files")
