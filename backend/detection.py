from ultralytics import YOLO
from detection_rules import normalize_class

class FireDetector:
    def __init__(self, model_path='best.pt'):
        # Load the custom fire detection model
        self.model = YOLO(model_path)
        print(f"Model loaded. Classes: {self.model.names}")
        names = {normalize_class(name) for name in self.model.names.values()}
        self.supported_classes = sorted(names & {"fire", "smoke"})
        if not {"fire", "smoke"}.issubset(names):
            raise ValueError("The configured model must contain both fire and smoke classes.")
        
    def process_frame(self, frame):
        """
        Process a single frame to detect objects (fire/smoke).
        Returns the source frame and raw detections. Source pipelines apply
        their shared confidence rules before drawing overlays.
        """
        # Class-specific filtering is applied by the shared rules after inference.
        results = self.model(frame, conf=0.01, verbose=False)
        annotated_frame = frame
        
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])
                name = self.model.names[cls]
                detections.append({
                    "class": name,
                    "confidence": conf,
                    "bbox": box.xyxy[0].tolist()
                })
                
        return annotated_frame, detections
