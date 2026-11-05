---
title: Anomaly Detection in Industry Manufacturing (PyTorch)
collection: projects
date: 2022-12-01
card_title: anomaly-detection
tagline: Computer-vision anomaly detection for industrial manufacturing defect inspection.
summary: A web pipeline for training and inference on Anomalib models, with a UI for MVTec-style datasets and per-image predictions.
role: Author
stack: Python, PyTorch, Flask
result: Source on GitHub; details in the Anomalib discussion forum.
repo: https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing
description: A web-based pipeline for training and running industrial anomaly detection on Anomalib models, with a UI for MVTec-style datasets and per-image predictions.
cover_alt: 'Anomaly detection app: input image, heatmap, mask and segmentation of a defective hazelnut'
featured: false
cover: /assets/projects/anomaly-detection.webp
image: /assets/projects/anomaly-detection-og.jpg
image_alt: 'Anomaly detection app: input image, heatmap, mask and segmentation of a defective hazelnut'
last_modified_at: 2026-11-05
---
This project showcases an end-to-end training and inference pipeline build on top of Anomalib. It provides a web-based UI for uploading MVTec style datasets and training them on the available Anomalib models. It also has sections for calling inference on individual images as well as listing all the images with their predictions in the database.

You can view the project on [Github](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/tree/master/anomalib_contribute)
For more details see the [Discussion forum](https://github.com/openvinotoolkit/anomalib/discussions/733)

## Technology used
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/technology_used.jpg?raw=true)

## App Flask
```
python app.py
```
Open local URL: http://127.0.0.1:5000

Default account login:
- Username: anomalib
- Password: anomalib

Models supported:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/models_supported.jpg?raw=true)

Login:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/login_app.jpg?raw=true)

Signup:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/signup_app.jpg?raw=true)

Homepage:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/home_app.jpg?raw=true)

Train:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/train_app.jpg?raw=true)

Inference:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/inference_app.jpg?raw=true)

Database:
![image](https://github.com/vnk8071/anomaly-detection-in-industry-manufacturing/blob/master/anomalib_contribute/static/database_app.jpg?raw=true)
